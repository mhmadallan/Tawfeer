# Tawfeer - Full Stack Grocery Bill Analyzer

Smart Expense Manager and AI Savings Assistant.

This project is split into two apps:

- `backend/`: Node.js + Express API, Supabase integration, OpenAI receipt analysis.
- `frontend/`: Vanilla JS + TailwindCSS UI.

## Cloud Deployment Targets

- Backend: Render (`render.yaml`)
- Frontend: Vercel (`frontend/vercel.json`)
- Database + Storage: Supabase

## 1) Supabase setup

1. Create a Supabase project.
2. Open SQL editor and run [`backend/sql/blueprint/schema_v2.sql`](./backend/sql/blueprint/schema_v2.sql).
3. Create a private storage bucket named `receipts`.
3. Copy your project values:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

## 2) Backend deployment on Render

Deploy using `render.yaml` in repository root.

Required Render environment variables:
- `FRONTEND_ORIGIN`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`

Optional:
- `OPENAI_MODEL` (default: `gpt-4o-mini`)
- `SUPABASE_RECEIPT_BUCKET` (default: `receipts`)
- `DEFAULT_USER_ID` (test fallback only)

## 3) Frontend deployment on Vercel

Deploy the `frontend/` folder to Vercel as a static app.

After deployment, open the app and set in Cloud Connection:
- Render backend URL
- User UUID (Supabase auth user id)

## API endpoints

- `GET /api/users/profile`
- `PUT /api/users/profile`
- `POST /api/receipts/analyze`
  - multipart form data:
    - `bill` (image file, required)
    - `storeName` (optional)
    - `purchaseDate` (optional, `YYYY-MM-DD`)
- `POST /api/items/manual`
  - JSON body: `name`, `price`, `quantity`, `category`, `isGrocery`, `purchaseDate`
- `GET /api/summary?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /api/receipts`
- `GET /api/weekly-list`
- `POST /api/discounts/search`
- `POST /api/suggestions/generate`

Request auth for user-scoped endpoints:
- `x-user-id` header with Supabase auth user UUID

## Notes

- OpenAI model can be changed with `OPENAI_MODEL`.
- Receipt files are uploaded to Supabase Storage bucket `receipts`.
- Current money display in frontend uses `$` formatting.

## AI Grocery Savings Blueprint Deliverables

Additional planning and implementation starter files are available:

- Product blueprint and architecture: `docs/ai-grocery-savings-blueprint.md`
- Expanded SQL schema for profiles, discounts, suggestions, and RLS: `backend/sql/blueprint/schema_v2.sql`
- Example code modules:
  - `backend/src/examples/receiptExtractionExample.js`
  - `backend/src/examples/weeklyListExample.js`
  - `backend/src/examples/discountSearchExample.js`
  - `backend/src/examples/savingsSuggestionsExample.js`

## Deployment Guide

See full guide: `docs/cloud-deployment.md`
