function normalizeKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function average(numbers) {
  if (!numbers.length) return 0;
  return numbers.reduce((sum, x) => sum + x, 0) / numbers.length;
}

export function buildWeeklyGroceryList({ purchases, weeksToScan = 8, minOccurrence = 2 }) {
  if (!Array.isArray(purchases)) {
    throw new Error("purchases must be an array");
  }

  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - weeksToScan * 7);

  const grouped = new Map();

  for (const row of purchases) {
    const purchasedAt = new Date(row.purchased_at);
    if (Number.isNaN(purchasedAt.getTime()) || purchasedAt < cutoff) {
      continue;
    }

    const key = normalizeKey(row.normalized_item_name || row.item_name);
    if (!key) continue;

    const entry = grouped.get(key) || {
      item_name: row.normalized_item_name || row.item_name,
      occurrences: 0,
      quantities: [],
      prices: [],
      categories: new Map()
    };

    entry.occurrences += 1;
    entry.quantities.push(Number(row.quantity || 1));
    entry.prices.push(Number(row.unit_price || 0));

    const category = row.category || "uncategorized";
    entry.categories.set(category, (entry.categories.get(category) || 0) + 1);

    grouped.set(key, entry);
  }

  const weeklyList = [];

  for (const [, entry] of grouped.entries()) {
    if (entry.occurrences < minOccurrence) continue;

    const category = [...entry.categories.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "uncategorized";
    const suggestedQty = Math.max(1, Math.round(average(entry.quantities)));
    const expectedUnitPrice = Number(average(entry.prices).toFixed(2));

    weeklyList.push({
      item_name: entry.item_name,
      category,
      suggested_quantity: suggestedQty,
      expected_unit_price: expectedUnitPrice,
      estimated_weekly_cost: Number((suggestedQty * expectedUnitPrice).toFixed(2)),
      confidence: Math.min(1, entry.occurrences / weeksToScan)
    });
  }

  return weeklyList.sort((a, b) => b.confidence - a.confidence || a.item_name.localeCompare(b.item_name));
}
