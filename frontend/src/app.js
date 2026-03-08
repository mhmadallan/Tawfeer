const API_BASE_URL = window.API_BASE_URL || "http://localhost:4000";

const receiptForm = document.getElementById("receiptForm");
const receiptStatus = document.getElementById("receiptStatus");
const manualItemForm = document.getElementById("manualItemForm");
const manualStatus = document.getElementById("manualStatus");
const analysisItemsTable = document.getElementById("analysisItemsTable");
const receiptsList = document.getElementById("receiptsList");

const totalSpentEl = document.getElementById("totalSpent");
const grocerySpentEl = document.getElementById("grocerySpent");
const nonGrocerySpentEl = document.getElementById("nonGrocerySpent");

const fromDateEl = document.getElementById("fromDate");
const toDateEl = document.getElementById("toDate");
const refreshSummaryBtn = document.getElementById("refreshSummary");

const formatMoney = (value) => `$${Number(value || 0).toFixed(2)}`;

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
};

const renderAnalysisItems = (items = []) => {
  analysisItemsTable.innerHTML = "";

  if (items.length === 0) {
    analysisItemsTable.innerHTML = `<tr><td class="px-3 py-2 text-slate-500" colspan="5">No analyzed items yet.</td></tr>`;
    return;
  }

  for (const item of items) {
    const tr = document.createElement("tr");
    tr.className = "border-b";
    tr.innerHTML = `
      <td class="px-3 py-2">${item.name}</td>
      <td class="px-3 py-2">${item.quantity}</td>
      <td class="px-3 py-2">${item.category}</td>
      <td class="px-3 py-2">${formatMoney(item.line_total)}</td>
      <td class="px-3 py-2">${item.is_grocery ? "Yes" : "No"}</td>
    `;
    analysisItemsTable.appendChild(tr);
  }
};

const loadSummary = async () => {
  const params = new URLSearchParams();
  if (fromDateEl.value) params.append("from", fromDateEl.value);
  if (toDateEl.value) params.append("to", toDateEl.value);

  const query = params.toString();
  const data = await fetchJson(`${API_BASE_URL}/api/summary${query ? `?${query}` : ""}`);

  totalSpentEl.textContent = formatMoney(data.total_spent);
  grocerySpentEl.textContent = formatMoney(data.grocery_spent);
  nonGrocerySpentEl.textContent = formatMoney(data.non_grocery_spent);
};

const loadReceipts = async () => {
  const receipts = await fetchJson(`${API_BASE_URL}/api/receipts`);
  receiptsList.innerHTML = "";

  if (receipts.length === 0) {
    receiptsList.innerHTML = `<li class="text-slate-500">No receipts yet.</li>`;
    return;
  }

  for (const receipt of receipts) {
    const li = document.createElement("li");
    li.className = "rounded-lg border border-slate-200 p-3";
    li.innerHTML = `
      <div class="font-medium">${receipt.store_name}</div>
      <div class="text-slate-600">${receipt.purchased_at} • Grocery: ${formatMoney(receipt.grocery_amount)} • Total: ${formatMoney(receipt.total_amount)}</div>
    `;
    receiptsList.appendChild(li);
  }
};

receiptForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  receiptStatus.textContent = "Analyzing bill...";

  try {
    const billImage = document.getElementById("billImage").files[0];
    if (!billImage) {
      throw new Error("Please choose a bill image.");
    }

    const formData = new FormData();
    formData.append("bill", billImage);

    const storeName = document.getElementById("storeName").value.trim();
    const purchaseDate = document.getElementById("purchaseDate").value;

    if (storeName) formData.append("storeName", storeName);
    if (purchaseDate) formData.append("purchaseDate", purchaseDate);

    const result = await fetchJson(`${API_BASE_URL}/api/receipts/analyze`, {
      method: "POST",
      body: formData
    });

    renderAnalysisItems(result.items || []);
    receiptStatus.textContent = `Saved receipt for ${result.receipt.store_name}. Grocery total: ${formatMoney(result.totals.grocery_total)}.`;

    await Promise.all([loadSummary(), loadReceipts()]);
    receiptForm.reset();
  } catch (error) {
    receiptStatus.textContent = error.message;
  }
});

manualItemForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  manualStatus.textContent = "Saving item...";

  try {
    const payload = {
      name: document.getElementById("itemName").value.trim(),
      price: Number(document.getElementById("itemPrice").value),
      quantity: Number(document.getElementById("itemQty").value || 1),
      category: document.getElementById("itemCategory").value.trim() || "manual",
      isGrocery: document.getElementById("isGrocery").checked,
      purchaseDate: document.getElementById("manualDate").value || undefined
    };

    await fetchJson(`${API_BASE_URL}/api/items/manual`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    manualStatus.textContent = "Item added successfully.";
    manualItemForm.reset();
    await loadSummary();
  } catch (error) {
    manualStatus.textContent = error.message;
  }
});

refreshSummaryBtn.addEventListener("click", async () => {
  try {
    await loadSummary();
  } catch (error) {
    alert(error.message);
  }
});

const init = async () => {
  renderAnalysisItems([]);
  await Promise.all([loadSummary(), loadReceipts()]);
};

init().catch((error) => {
  console.error(error);
  alert(`Initialization failed: ${error.message}`);
});
