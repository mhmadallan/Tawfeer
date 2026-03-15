import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import multer from "multer";

dotenv.config();

import { supabase } from "./supabase.js";
import { openai } from "./openai.js";
import { buildWeeklyGroceryList } from "./examples/weeklyListExample.js";
import {
  fetchDiscountsFromApi,
  fetchDiscountsFromPublicPage,
  matchOffersToList
} from "./examples/discountSearchExample.js";
import { generateSavingSuggestions } from "./examples/savingsSuggestionsExample.js";

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const port = process.env.PORT || 4000;
const frontendOriginRaw = process.env.FRONTEND_ORIGIN || "*";
const frontendOrigin = frontendOriginRaw.includes(",")
  ? frontendOriginRaw
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
  : frontendOriginRaw;
const aiModel = process.env.OPENAI_MODEL || "gpt-4o-mini";
const receiptBucket = process.env.SUPABASE_RECEIPT_BUCKET || "receipts";
const defaultUserId = process.env.DEFAULT_USER_ID || null;

app.use(
  cors({
    origin: frontendOrigin === "*" ? true : frontendOrigin
  })
);
app.use(express.json());

const parseNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const isUuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));

const normalizeItemName = (name) =>
  String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const getUserId = (req) => {
  const candidate =
    req.headers["x-user-id"] || req.body?.userId || req.query?.userId || defaultUserId || "";

  if (!isUuid(candidate)) {
    return null;
  }

  return candidate;
};

const requireUserId = (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    res.status(400).json({
      error:
        "A valid user id is required. Provide x-user-id header or userId field with a UUID value."
    });
    return null;
  }
  return userId;
};

const uploadReceiptToSupabaseStorage = async ({ userId, file }) => {
  const originalName = String(file.originalname || "receipt").replace(/[^a-zA-Z0-9._-]/g, "_");
  const storagePath = `${userId}/${Date.now()}-${originalName}`;

  const { error } = await supabase.storage.from(receiptBucket).upload(storagePath, file.buffer, {
    contentType: file.mimetype,
    upsert: false
  });

  if (error) {
    throw new Error(`Failed to upload receipt to Supabase Storage: ${error.message}`);
  }

  return storagePath;
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
        normalized_item_name: normalizeItemName(item.name || "Unknown item"),
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
  res.json({ ok: true, service: "tawfeer-backend" });
});

app.get("/api/users/profile", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  try {
    const { data, error } = await supabase
      .from("user_profiles")
      .select("user_id,display_name,family_size,monthly_budget,dietary_preferences,preferred_stores,currency")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) throw error;
    return res.json(data || null);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || "Failed to fetch profile." });
  }
});

app.put("/api/users/profile", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  try {
    const payload = {
      user_id: userId,
      display_name: req.body.displayName || null,
      family_size: Math.max(1, parseInt(req.body.familySize ?? 1, 10)),
      monthly_budget:
        req.body.monthlyBudget === undefined || req.body.monthlyBudget === null
          ? null
          : parseNumber(req.body.monthlyBudget, null),
      dietary_preferences: Array.isArray(req.body.dietaryPreferences) ? req.body.dietaryPreferences : [],
      preferred_stores: Array.isArray(req.body.preferredStores) ? req.body.preferredStores : [],
      currency: String(req.body.currency || "USD").toUpperCase(),
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
      .from("user_profiles")
      .upsert(payload, { onConflict: "user_id" })
      .select("user_id,display_name,family_size,monthly_budget,dietary_preferences,preferred_stores,currency")
      .single();

    if (error) throw error;
    return res.json(data);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || "Failed to save profile." });
  }
});

app.post("/api/receipts/analyze", upload.single("bill"), async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  try {
    if (!req.file) {
      return res.status(400).json({ error: "Please upload a bill image using field name 'bill'." });
    }

    const { storeName = null, purchaseDate = null } = req.body;

    const analysis = await analyzeReceiptImage(req.file, storeName, purchaseDate);
    const items = sanitizeItems(analysis.items);
    const { receiptTotal, groceryTotal } = computeTotals(items, analysis.receipt_total);
    const sourceFilePath = await uploadReceiptToSupabaseStorage({ userId, file: req.file });

    const receiptPayload = {
      user_id: userId,
      store_name: analysis.store_name || storeName || "Unknown store",
      purchased_at: analysis.purchase_date || purchaseDate || new Date().toISOString().slice(0, 10),
      currency: analysis.currency || "USD",
      total_amount: receiptTotal,
      grocery_amount: groceryTotal,
      source_file_path: sourceFilePath,
      parsing_confidence: 0.75
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
      normalized_item_name: item.normalized_item_name,
      user_id: userId,
      quantity: item.quantity,
      unit_price: item.unit_price,
      line_total: item.line_total,
      category: item.category,
      is_grocery: item.is_grocery,
      purchased_at: receiptPayload.purchased_at
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
  const userId = requireUserId(req, res);
  if (!userId) return;

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
      user_id: userId,
      item_name: String(name).trim(),
      normalized_item_name: normalizeItemName(name),
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
  const userId = requireUserId(req, res);
  if (!userId) return;

  try {
    const { from, to } = req.query;

    let receiptsQuery = supabase
      .from("receipts")
      .select("total_amount,grocery_amount,purchased_at")
      .eq("user_id", userId);
    let manualQuery = supabase
      .from("manual_items")
      .select("line_total,is_grocery,purchased_at")
      .eq("user_id", userId);

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
  const userId = requireUserId(req, res);
  if (!userId) return;

  try {
    const { data, error } = await supabase
      .from("receipts")
      .select("id,store_name,purchased_at,currency,total_amount,grocery_amount")
      .eq("user_id", userId)
      .order("purchased_at", { ascending: false })
      .limit(20);

    if (error) throw error;
    return res.json(data || []);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || "Failed to fetch receipts." });
  }
});

app.get("/api/weekly-list", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  try {
    const weeks = Math.max(2, parseInt(req.query.weeks || "8", 10));
    const minOccurrence = Math.max(1, parseInt(req.query.minOccurrence || "2", 10));

    const { data: purchases, error } = await supabase
      .from("receipt_items")
      .select("item_name,normalized_item_name,quantity,unit_price,category,purchased_at")
      .eq("user_id", userId)
      .order("purchased_at", { ascending: false })
      .limit(5000);

    if (error) throw error;

    const weeklyList = buildWeeklyGroceryList({
      purchases: purchases || [],
      weeksToScan: weeks,
      minOccurrence
    });

    return res.json({
      weeks,
      min_occurrence: minOccurrence,
      item_count: weeklyList.length,
      items: weeklyList
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || "Failed to build weekly list." });
  }
});

app.post("/api/discounts/search", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  try {
    const {
      query = "grocery",
      discountApiBaseUrl,
      discountApiKey,
      scrapeUrls = [],
      usualList = []
    } = req.body || {};

    let resolvedList = Array.isArray(usualList) ? usualList : [];

    if (resolvedList.length === 0) {
      const { data: purchases, error } = await supabase
        .from("receipt_items")
        .select("item_name,normalized_item_name,quantity,unit_price,category,purchased_at")
        .eq("user_id", userId)
        .order("purchased_at", { ascending: false })
        .limit(3000);

      if (error) throw error;
      resolvedList = buildWeeklyGroceryList({ purchases: purchases || [] });
    }

    const offers = [];
    const sources = [];

    if (discountApiBaseUrl) {
      const apiOffers = await fetchDiscountsFromApi({
        baseUrl: discountApiBaseUrl,
        apiKey: discountApiKey,
        query
      });
      offers.push(...apiOffers);
      sources.push("api");
    }

    for (const url of scrapeUrls) {
      const scraped = await fetchDiscountsFromPublicPage({ url });
      offers.push(...scraped);
      sources.push(`scrape:${url}`);
    }

    const matches = matchOffersToList({ usualList: resolvedList, offers });

    return res.json({
      sources,
      offers_found: offers.length,
      matched_offers: matches.length,
      items: matches
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || "Failed to search discounts." });
  }
});

app.post("/api/suggestions/generate", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  try {
    const monthAgo = new Date();
    monthAgo.setDate(monthAgo.getDate() - 30);
    const fromDate = monthAgo.toISOString().slice(0, 10);

    const [{ data: profile, error: profileError }, { data: monthlyHistory, error: historyError }] =
      await Promise.all([
        supabase
          .from("user_profiles")
          .select("family_size,monthly_budget,dietary_preferences,preferred_stores,currency")
          .eq("user_id", userId)
          .maybeSingle(),
        supabase
          .from("receipt_items")
          .select("line_total,is_grocery,category")
          .eq("user_id", userId)
          .gte("purchased_at", fromDate)
      ]);

    if (profileError) throw profileError;
    if (historyError) throw historyError;

    let weeklyList = req.body?.weeklyList;
    if (!Array.isArray(weeklyList) || weeklyList.length === 0) {
      const { data: purchases, error: purchasesError } = await supabase
        .from("receipt_items")
        .select("item_name,normalized_item_name,quantity,unit_price,category,purchased_at")
        .eq("user_id", userId)
        .order("purchased_at", { ascending: false })
        .limit(3000);

      if (purchasesError) throw purchasesError;
      weeklyList = buildWeeklyGroceryList({ purchases: purchases || [] });
    }

    const discountMatches = Array.isArray(req.body?.discountMatches) ? req.body.discountMatches : [];

    const suggestions = generateSavingSuggestions({
      profile: profile || {},
      monthlyHistory: monthlyHistory || [],
      weeklyList: weeklyList || [],
      discountMatches
    });

    if (suggestions.length > 0) {
      const records = suggestions.slice(0, 20).map((entry) => ({
        user_id: userId,
        suggestion_type: entry.type,
        title: entry.title,
        message: entry.message,
        estimated_savings: entry.estimated_savings,
        payload: entry,
        status: "new"
      }));

      const { error: saveError } = await supabase.from("user_suggestion_events").insert(records);
      if (saveError) {
        console.error("Failed to persist suggestions", saveError.message);
      }
    }

    return res.json({
      count: suggestions.length,
      items: suggestions
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message || "Failed to generate suggestions." });
  }
});

app.listen(port, () => {
  console.log(`Backend running on port ${port}`);
});
