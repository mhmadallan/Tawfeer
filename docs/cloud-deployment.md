# Cloud Deployment Guide

This project is configured for:
- Backend on Render
- Frontend on Vercel
- Database and file storage on Supabase

## 1) Supabase (database + storage)

1. Create a Supabase project.
2. In Supabase SQL editor, run `backend/sql/blueprint/schema_v2.sql`.
3. In Supabase Storage, create a private bucket named `receipts`.
4. Copy these values from Supabase project settings:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

## 2) Deploy Backend to Render

1. Connect your GitHub repository to Render.
2. Create a Blueprint deploy from `render.yaml` in repo root.
3. Set these environment variables in Render service:
   - `FRONTEND_ORIGIN` (your frontend URL, e.g. `https://your-app.vercel.app`)
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `OPENAI_API_KEY`
   - `OPENAI_MODEL` (optional, default `gpt-4o-mini`)
   - `SUPABASE_RECEIPT_BUCKET` (default `receipts`)
   - `DEFAULT_USER_ID` (optional fallback for testing)
4. Deploy and copy your backend URL, for example:
   - `https://tawfeer-backend.onrender.com`

## 3) Deploy Frontend to Vercel

1. Import the `frontend` folder as a Vercel project.
2. Framework preset: Other.
3. No build command required for this static site.
4. Deploy.
5. Open frontend and set these in the Cloud Connection section:
   - Render backend URL
   - User UUID (Supabase auth user id)

## 4) API Authentication Note

Current API expects a valid user UUID per request in:
- Header: `x-user-id`

The frontend sends this header automatically from Cloud Connection settings.

## 5) Supported Cloud Endpoints

- `GET /health`
- `GET /api/users/profile`
- `PUT /api/users/profile`
- `POST /api/receipts/analyze`
- `POST /api/items/manual`
- `GET /api/summary`
- `GET /api/receipts`
- `GET /api/weekly-list`
- `POST /api/discounts/search`
- `POST /api/suggestions/generate`
