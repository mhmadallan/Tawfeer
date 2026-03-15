function pct(value) {
  return `${(value * 100).toFixed(0)}%`;
}

function sum(values) {
  return values.reduce((acc, x) => acc + Number(x || 0), 0);
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

export function generateSavingSuggestions({ profile, monthlyHistory, weeklyList, discountMatches }) {
  const suggestions = [];

  const monthlyTotal = sum(monthlyHistory.map((x) => x.line_total));
  const groceryTotal = sum(monthlyHistory.filter((x) => x.is_grocery).map((x) => x.line_total));

  if (profile?.monthly_budget && monthlyTotal > profile.monthly_budget) {
    const over = monthlyTotal - profile.monthly_budget;
    suggestions.push({
      type: "budget_alert",
      title: "Monthly budget exceeded",
      message: `Current month spending is ${over.toFixed(2)} above your target budget.`,
      estimated_savings: Number(over.toFixed(2)),
      priority: "high"
    });
  }

  if (profile?.family_size && profile.family_size >= 4) {
    const bulkCandidates = weeklyList
      .filter((item) => item.suggested_quantity >= 2 && item.expected_unit_price > 0)
      .slice(0, 5);

    for (const item of bulkCandidates) {
      const estimatedBulkUnitDrop = item.expected_unit_price * 0.08;
      const monthlySavings = estimatedBulkUnitDrop * item.suggested_quantity * 4;

      suggestions.push({
        type: "bulk_buying",
        title: `Consider bulk pack for ${item.item_name}`,
        message: `Large-family profile detected. Bulk options can save around ${pct(0.08)} per unit.`,
        estimated_savings: Number(monthlySavings.toFixed(2)),
        priority: "medium"
      });
    }
  }

  const categorySpend = groupBy(monthlyHistory, (x) => x.category || "uncategorized");
  for (const [category, rows] of categorySpend.entries()) {
    const spend = sum(rows.map((x) => x.line_total));
    if (spend < 40) continue;

    if (category.toLowerCase().includes("snack") || category.toLowerCase().includes("beverage")) {
      suggestions.push({
        type: "substitution",
        title: `High spend in ${category}`,
        message: "Try store-brand or seasonal alternatives for this category.",
        estimated_savings: Number((spend * 0.12).toFixed(2)),
        priority: "medium"
      });
    }
  }

  const topDiscounts = (discountMatches || []).slice(0, 5);
  for (const match of topDiscounts) {
    if (match.estimated_savings < 1) continue;

    suggestions.push({
      type: "active_discount",
      title: `${match.offer_item} is currently discounted`,
      message: `Switching this week can save about ${match.estimated_savings.toFixed(2)}.`,
      estimated_savings: Number(match.estimated_savings.toFixed(2)),
      priority: "high",
      action_url: match.offer_url || null
    });
  }

  if (groceryTotal > 0 && weeklyList.length > 0) {
    const estimatedWeekly = sum(weeklyList.map((x) => x.estimated_weekly_cost));
    const projectedMonthly = estimatedWeekly * 4;

    if (projectedMonthly > groceryTotal * 1.15) {
      suggestions.push({
        type: "overbuy_risk",
        title: "Projected grocery plan is above recent trend",
        message: "Review low-priority list items before checkout to avoid overbuying.",
        estimated_savings: Number((projectedMonthly - groceryTotal).toFixed(2)),
        priority: "low"
      });
    }
  }

  return suggestions.sort((a, b) => b.estimated_savings - a.estimated_savings);
}
