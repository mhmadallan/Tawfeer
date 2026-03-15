import axios from "axios";
import * as cheerio from "cheerio";

function normalizeItemName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function overlapScore(a, b) {
  const aTokens = new Set(normalizeItemName(a).split(" ").filter(Boolean));
  const bTokens = new Set(normalizeItemName(b).split(" ").filter(Boolean));
  if (!aTokens.size || !bTokens.size) return 0;

  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap += 1;
  }

  return overlap / Math.max(aTokens.size, bTokens.size);
}

export async function fetchDiscountsFromApi({ baseUrl, apiKey, query }) {
  if (!baseUrl) throw new Error("baseUrl is required");

  const response = await axios.get(`${baseUrl}/offers`, {
    params: { q: query, limit: 25 },
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
  });

  return (response.data?.offers || []).map((offer) => ({
    source: "api",
    store_name: offer.store || "unknown",
    item_name: offer.item_name,
    regular_price: Number(offer.regular_price || 0),
    discount_price: Number(offer.discount_price || 0),
    offer_url: offer.url || null,
    ends_at: offer.ends_at || null
  }));
}

export async function fetchDiscountsFromPublicPage({ url }) {
  if (!url) throw new Error("url is required");

  const html = await axios.get(url, { timeout: 10000 }).then((r) => r.data);
  const $ = cheerio.load(html);

  const offers = [];

  $("[data-offer-item], .offer-card").each((_, node) => {
    const el = $(node);
    const itemName =
      el.attr("data-offer-item") || el.find(".offer-title, .item-title, h3").first().text().trim();

    const discountText = el.find(".offer-price, .price-new").first().text().replace(/[^0-9.]/g, "");
    const regularText = el.find(".price-old, .regular-price").first().text().replace(/[^0-9.]/g, "");

    const discountPrice = Number(discountText || 0);
    const regularPrice = Number(regularText || discountPrice);

    if (!itemName || !discountPrice) return;

    offers.push({
      source: "scrape",
      store_name: "unknown",
      item_name: itemName,
      regular_price: regularPrice,
      discount_price: discountPrice,
      offer_url: url,
      ends_at: null
    });
  });

  return offers;
}

export function matchOffersToList({ usualList, offers, minScore = 0.4 }) {
  const matches = [];

  for (const item of usualList) {
    for (const offer of offers) {
      const score = overlapScore(item.item_name, offer.item_name);
      if (score < minScore) continue;

      const regular = Number(offer.regular_price || item.expected_unit_price || 0);
      const discounted = Number(offer.discount_price || regular);
      const savingsPerUnit = Math.max(0, regular - discounted);

      matches.push({
        list_item: item.item_name,
        offer_item: offer.item_name,
        store_name: offer.store_name,
        score: Number(score.toFixed(2)),
        regular_price: regular,
        discount_price: discounted,
        estimated_savings: Number((savingsPerUnit * Number(item.suggested_quantity || 1)).toFixed(2)),
        offer_url: offer.offer_url
      });
    }
  }

  return matches.sort((a, b) => b.estimated_savings - a.estimated_savings || b.score - a.score);
}
