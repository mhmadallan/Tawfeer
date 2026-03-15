import OpenAI from "openai";

const aiModel = process.env.OPENAI_MODEL || "gpt-4o-mini";

const stopwords = new Set([
  "fresh",
  "brand",
  "market",
  "super",
  "store",
  "premium",
  "local",
  "the"
]);

function parseNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeProductName(name) {
  const normalized = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = normalized
    .split(" ")
    .filter((token) => token.length > 1 && !stopwords.has(token));

  return tokens.join(" ") || "unknown";
}

export function sanitizeReceiptItems(rawItems = []) {
  if (!Array.isArray(rawItems)) return [];

  return rawItems
    .map((item) => {
      const quantity = parseNumber(item.quantity, 1);
      const unitPrice = parseNumber(item.unit_price, 0);
      const lineTotal = parseNumber(item.line_total, quantity * unitPrice);

      const rawName = String(item.name || "Unknown item").trim();
      const normalizedName = normalizeProductName(rawName);

      return {
        item_name: rawName,
        normalized_item_name: normalizedName,
        quantity: Number(quantity.toFixed(2)),
        unit_price: Number(unitPrice.toFixed(2)),
        line_total: Number(lineTotal.toFixed(2)),
        category: String(item.category || "uncategorized").trim(),
        is_grocery: Boolean(item.is_grocery)
      };
    })
    .filter((item) => item.item_name.length > 0);
}

export async function extractReceiptData({ openaiApiKey, imageMimeType, imageBuffer, storeName, purchaseDate }) {
  if (!openaiApiKey) {
    throw new Error("openaiApiKey is required");
  }

  if (!imageBuffer || imageBuffer.length === 0) {
    throw new Error("imageBuffer is required");
  }

  const openai = new OpenAI({ apiKey: openaiApiKey });
  const dataUrl = `data:${imageMimeType || "image/jpeg"};base64,${imageBuffer.toString("base64")}`;

  const prompt = [
    "Extract supermarket receipt line items.",
    "Return strict JSON with keys:",
    "store_name, purchase_date, currency, receipt_total, items[].",
    "Each item includes name, quantity, unit_price, line_total, category, is_grocery.",
    "Numbers must be numeric.",
    "If quantity missing, use 1.",
    `Context store_name=${storeName || "unknown"}, purchase_date=${purchaseDate || "unknown"}.`
  ].join("\n");

  const response = await openai.chat.completions.create({
    model: aiModel,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "You convert receipt images into structured purchase data." },
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: dataUrl } }
        ]
      }
    ]
  });

  const payload = response.choices?.[0]?.message?.content;
  if (!payload) {
    throw new Error("No structured payload returned from model");
  }

  const parsed = JSON.parse(payload);
  const items = sanitizeReceiptItems(parsed.items);

  return {
    store_name: parsed.store_name || storeName || null,
    purchase_date: parsed.purchase_date || purchaseDate || null,
    currency: parsed.currency || "USD",
    receipt_total: parseNumber(parsed.receipt_total, items.reduce((sum, it) => sum + it.line_total, 0)),
    items
  };
}
