# Tawfeer - Full Stack Grocery Bill Analyzer

Smart Expense Manager and AI Savings Assistant.

This project is split into two apps:

- `backend/`: Node.js + Express API, Supabase integration, OpenAI receipt analysis.
- `frontend/`: Vanilla JS + TailwindCSS UI.

## 1) Supabase setup

1. Create a Supabase project.
2. Open SQL editor and run [`backend/sql/schema.sql`](./backend/sql/schema.sql).
3. Copy your project values:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

## 2) Backend setup

```bash
cd backend
cp .env.example .env
# fill OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
npm install
npm run dev
```

Backend runs by default on `http://localhost:4000`.

## 3) Frontend setup

```bash
cd frontend
npm install
npm run start
```

Frontend runs by default on `http://localhost:5173` and calls backend at `http://localhost:4000`.

## API endpoints

- `POST /api/receipts/analyze`
  - multipart form data:
    - `bill` (image file, required)
    - `storeName` (optional)
    - `purchaseDate` (optional, `YYYY-MM-DD`)
- `POST /api/items/manual`
  - JSON body: `name`, `price`, `quantity`, `category`, `isGrocery`, `purchaseDate`
- `GET /api/summary?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /api/receipts`

## Notes

- OpenAI model can be changed with `OPENAI_MODEL` in backend `.env`.
- Current money display in frontend uses `$` formatting.
