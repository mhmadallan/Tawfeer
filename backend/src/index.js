import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import multer from "multer";

dotenv.config();

import { supabase } from "./supabase.js";
import { openai } from "./openai.js";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const port = process.env.PORT || 4000;
const frontendOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
const aiModel = process.env.OPENAI_MODEL || "gpt-4o-mini";

app.use(cors({ origin: frontendOrigin }));
app.use(express.json());

const parseNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const buildReceiptPrompt = (storeName, purchaseDate) => {
  return `You are a receipt parser. Extract every line item from this supermarket receipt image.\n\nReturn strict JSON with this shape:\n{\n  "store_name": "string or null",\n  "purchase_date": "YYYY-MM-DD or null",\n  "currency": "3-letter code like USD/EUR",\n  "items": [\n    {\n      "name": "string",\n      "quantity": number,\n      "unit_price": number,\n      "line_total": number,\n      "category": "string",\n      "is_grocery": boolean\n    }\n  ],\n  "receipt_total": number\n}\n\nRules:\n- If quantity is missing, set it to 1.
- Numbers must be numeric, not strings.
- Mark is_grocery true only for food and household grocery purchases.
- Use provided context when available.\n\nContext store_name=${storeName || "unknown"}, purchase_date=${purchaseDate || "unknown"}.`;
};

const analyzeReceiptImage = async (file, storeName, purchaseDate) => {
  const dataUrl = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;

  const completion = await openai.chat.completions.create({
    model: aiModel,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You extract structured shopping data from receipt images."
      },
      {
        role: "user",
        content: [
          { type: "text", text: buildReceiptPrompt(storeName, purchaseDate) },
          { type: "image_url", image_url: { url: dataUrl } }
        ]
      }
    ]
  });

  const jsonText = completion.choices?.[0]?.message?.content;
  if (!jsonText) {
    throw new Error("OpenAI did not return a valid analysis payload.");
  }

  return JSON.parse(jsonText);
};

const sanitizeItems = (items) => {
  if (!Array.isArray(items)) return [];

  return items
    .map((item) => {
      const quantity = parseNumber(item.quantity, 1);
      const unitPrice = parseNumber(item.unit_price, 0);
      const fallbackLineTotal = Number((quantity * unitPrice).toFixed(2));
      const lineTotal = parseNumber(item.line_total, fallbackLineTotal);

      return {
        name: String(item.name || "Unknown item").trim(),
        quantity,
        unit_price: unitPrice,
        line_total: lineTotal,
        category: String(item.category || "uncategorized").trim(),
        is_grocery: Boolean(item.is_grocery)
      };
    })
    .filter((item) => item.name.length > 0);
};

const computeTotals = (items, receiptTotalFromAi) => {
  const computedTotal = items.reduce((sum, item) => sum + parseNumber(item.line_total), 0);
  const receiptTotal = parseNumber(receiptTotalFromAi, computedTotal);
  const groceryTotal = items
    .filter((item) => item.is_grocery)
    .reduce((sum, item) => sum + parseNumber(item.line_total), 0);

  return {
    receiptTotal: Number(receiptTotal.toFixed(2)),
    groceryTotal: Number(groceryTotal.toFixed(2))
  };
};

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/receipts/analyze", upload.single("bill"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Please upload a bill image using field name 'bill'." });
    }

    const { storeName = null, purchaseDate = null } = req.body;

    const analysis = await analyzeReceiptImage(req.file, storeName, purchaseDate);
    const items = sanitizeItems(analysis.items);
    const { receiptTotal, groceryTotal } = computeTotals(items, analysis.receipt_total);

    const receiptPayload = {
      store_name: analysis.store_name || storeName || "Unknown store",
      purchased_at: analysis.purchase_date || purchaseDate || new Date().toISOString().slice(0, 10),
      currency: analysis.currency || "USD",
      total_amount: receiptTotal,
      grocery_amount: groceryTotal
    };

    const { data: receipt, error: receiptError } = await supabase
      .from("receipts")
      .insert(receiptPayload)
      .select()
      .single();

    if (receiptError) {
      throw receiptError;
    }

    const itemPayload = items.map((item) => ({
      receipt_id: receipt.id,
      item_name: item.name,
      quantity: item.quantity,
      unit_price: item.unit_price,
      line_total: item.line_total,
      category: item.category,
      is_grocery: item.is_grocery
    }));

    if (itemPayload.length > 0) {
      const { error: itemsError } = await supabase.from("receipt_items").insert(itemPayload);
      if (itemsError) {
        throw itemsError;
      }
    }

    return res.status(201).json({
      receipt,
      items,
      totals: {
        receipt_total: receiptTotal,
        grocery_total: groceryTotal
      }
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || "Failed to analyze receipt." });
  }
});

app.post("/api/items/manual", async (req, res) => {
  try {
    const {
      name,
      price,
      quantity = 1,
      category = "manual",
      isGrocery = true,
      purchaseDate = new Date().toISOString().slice(0, 10)
    } = req.body;

    if (!name || parseNumber(price, -1) < 0) {
      return res.status(400).json({ error: "'name' and valid 'price' are required." });
    }

    const qty = parseNumber(quantity, 1);
    const unitPrice = parseNumber(price, 0);
    const lineTotal = Number((qty * unitPrice).toFixed(2));

    const payload = {
      item_name: String(name).trim(),
      quantity: qty,
      unit_price: unitPrice,
      line_total: lineTotal,
      category,
      is_grocery: Boolean(isGrocery),
      purchased_at: purchaseDate
    };

    const { data, error } = await supabase.from("manual_items").insert(payload).select().single();

    if (error) {
      throw error;
    }

    return res.status(201).json(data);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || "Failed to add manual item." });
  }
});

app.get("/api/summary", async (req, res) => {
  try {
    const { from, to } = req.query;

    let receiptsQuery = supabase.from("receipts").select("total_amount,grocery_amount,purchased_at");
    let manualQuery = supabase.from("manual_items").select("line_total,is_grocery,purchased_at");

    if (from) {
      receiptsQuery = receiptsQuery.gte("purchased_at", from);
      manualQuery = manualQuery.gte("purchased_at", from);
    }

    if (to) {
      receiptsQuery = receiptsQuery.lte("purchased_at", to);
      manualQuery = manualQuery.lte("purchased_at", to);
    }

    const [{ data: receipts, error: receiptsError }, { data: manualItems, error: manualError }] =
      await Promise.all([receiptsQuery, manualQuery]);

    if (receiptsError) throw receiptsError;
    if (manualError) throw manualError;

    const receiptTotal = (receipts || []).reduce((sum, r) => sum + parseNumber(r.total_amount), 0);
    const receiptGrocery = (receipts || []).reduce((sum, r) => sum + parseNumber(r.grocery_amount), 0);

    const manualTotal = (manualItems || []).reduce((sum, i) => sum + parseNumber(i.line_total), 0);
    const manualGrocery = (manualItems || [])
      .filter((i) => i.is_grocery)
      .reduce((sum, i) => sum + parseNumber(i.line_total), 0);

    const totalSpent = Number((receiptTotal + manualTotal).toFixed(2));
    const grocerySpent = Number((receiptGrocery + manualGrocery).toFixed(2));

    return res.json({
      from: from || null,
      to: to || null,
      total_spent: totalSpent,
      grocery_spent: grocerySpent,
      non_grocery_spent: Number((totalSpent - grocerySpent).toFixed(2))
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || "Failed to fetch summary." });
  }
});

app.get("/api/receipts", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("receipts")
      .select("id,store_name,purchased_at,currency,total_amount,grocery_amount")
      .order("purchased_at", { ascending: false })
      .limit(20);

    if (error) throw error;
    return res.json(data || []);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || "Failed to fetch receipts." });
  }
});

app.listen(port, () => {
  console.log(`Backend running at http://localhost:${port}`);
});
