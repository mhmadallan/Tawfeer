-- Run this inside Supabase SQL editor
create extension if not exists pgcrypto;

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  store_name text not null,
  purchased_at date not null,
  currency text not null default 'USD',
  total_amount numeric(12,2) not null default 0,
  grocery_amount numeric(12,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts(id) on delete cascade,
  item_name text not null,
  quantity numeric(10,2) not null default 1,
  unit_price numeric(12,2) not null default 0,
  line_total numeric(12,2) not null default 0,
  category text not null default 'uncategorized',
  is_grocery boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.manual_items (
  id uuid primary key default gen_random_uuid(),
  item_name text not null,
  quantity numeric(10,2) not null default 1,
  unit_price numeric(12,2) not null default 0,
  line_total numeric(12,2) not null default 0,
  category text not null default 'manual',
  is_grocery boolean not null default true,
  purchased_at date not null default current_date,
  created_at timestamptz not null default now()
);

alter table public.receipts disable row level security;
alter table public.receipt_items disable row level security;
alter table public.manual_items disable row level security;
