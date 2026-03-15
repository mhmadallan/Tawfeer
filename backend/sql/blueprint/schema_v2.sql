-- AI Grocery Savings app schema (v2)
-- Designed for Supabase Postgres with RLS enabled.

create extension if not exists pgcrypto;

-- Users are managed by supabase auth.users.
-- This profile table stores personalization metadata.
create table if not exists public.user_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text,
  family_size integer not null default 1 check (family_size >= 1),
  monthly_budget numeric(12,2),
  dietary_preferences jsonb not null default '[]'::jsonb,
  preferred_stores jsonb not null default '[]'::jsonb,
  currency text not null default 'USD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  store_name text,
  purchased_at date not null,
  currency text not null default 'USD',
  total_amount numeric(12,2) not null default 0,
  grocery_amount numeric(12,2) not null default 0,
  raw_ocr_text text,
  source_file_path text,
  parsing_confidence numeric(5,4),
  created_at timestamptz not null default now()
);

create index if not exists idx_receipts_user_date on public.receipts(user_id, purchased_at desc);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  category text,
  brand text,
  default_unit text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_products_canonical_brand
on public.products(canonical_name, coalesce(brand, ''));

create table if not exists public.product_aliases (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  alias_name text not null,
  normalized_alias text not null,
  created_at timestamptz not null default now(),
  unique(normalized_alias)
);

create table if not exists public.receipt_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  receipt_id uuid not null references public.receipts(id) on delete cascade,
  product_id uuid references public.products(id),
  item_name text not null,
  normalized_item_name text,
  quantity numeric(10,2) not null default 1,
  unit_price numeric(12,2) not null default 0,
  line_total numeric(12,2) not null default 0,
  category text,
  is_grocery boolean not null default true,
  purchased_at date not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_receipt_items_user_date on public.receipt_items(user_id, purchased_at desc);
create index if not exists idx_receipt_items_product on public.receipt_items(product_id);

create table if not exists public.receipt_item_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  receipt_item_id uuid not null references public.receipt_items(id) on delete cascade,
  corrected_name text,
  corrected_quantity numeric(10,2),
  corrected_unit_price numeric(12,2),
  corrected_category text,
  was_correct boolean,
  created_at timestamptz not null default now()
);

create table if not exists public.manual_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_name text not null,
  normalized_item_name text,
  quantity numeric(10,2) not null default 1,
  unit_price numeric(12,2) not null default 0,
  line_total numeric(12,2) not null default 0,
  category text not null default 'manual',
  is_grocery boolean not null default true,
  purchased_at date not null default current_date,
  created_at timestamptz not null default now()
);

create index if not exists idx_manual_items_user_date on public.manual_items(user_id, purchased_at desc);

create table if not exists public.discount_offers (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  store_name text not null,
  product_id uuid references public.products(id),
  offer_item_name text not null,
  normalized_offer_name text,
  regular_price numeric(12,2),
  discount_price numeric(12,2),
  starts_at date,
  ends_at date,
  offer_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_discount_offers_dates on public.discount_offers(store_name, ends_at);

create table if not exists public.user_suggestion_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  suggestion_type text not null,
  title text not null,
  message text not null,
  estimated_savings numeric(12,2),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'new',
  created_at timestamptz not null default now()
);

create table if not exists public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  push_enabled boolean not null default true,
  email_enabled boolean not null default true,
  weekly_report_enabled boolean not null default true,
  monthly_report_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

-- RLS enablement
alter table public.user_profiles enable row level security;
alter table public.receipts enable row level security;
alter table public.receipt_items enable row level security;
alter table public.receipt_item_feedback enable row level security;
alter table public.manual_items enable row level security;
alter table public.user_suggestion_events enable row level security;
alter table public.notification_preferences enable row level security;

-- Open catalog tables can remain readable; optionally keep RLS disabled.
alter table public.products disable row level security;
alter table public.product_aliases disable row level security;
alter table public.discount_offers disable row level security;

-- Policies: user-owned tables
drop policy if exists user_profiles_owner_select on public.user_profiles;
create policy user_profiles_owner_select on public.user_profiles
for select to authenticated using (auth.uid() = user_id);

drop policy if exists user_profiles_owner_insert on public.user_profiles;
create policy user_profiles_owner_insert on public.user_profiles
for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists user_profiles_owner_update on public.user_profiles;
create policy user_profiles_owner_update on public.user_profiles
for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists receipts_owner_all on public.receipts;
create policy receipts_owner_all on public.receipts
for all to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists receipt_items_owner_all on public.receipt_items;
create policy receipt_items_owner_all on public.receipt_items
for all to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists receipt_item_feedback_owner_all on public.receipt_item_feedback;
create policy receipt_item_feedback_owner_all on public.receipt_item_feedback
for all to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists manual_items_owner_all on public.manual_items;
create policy manual_items_owner_all on public.manual_items
for all to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists user_suggestion_events_owner_all on public.user_suggestion_events;
create policy user_suggestion_events_owner_all on public.user_suggestion_events
for all to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists notification_preferences_owner_all on public.notification_preferences;
create policy notification_preferences_owner_all on public.notification_preferences
for all to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
