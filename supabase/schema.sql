-- ============================================
-- TAWFEER — Supabase Database Schema
-- Run this in your Supabase SQL Editor
-- ============================================

-- Users profile extension (linked to auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  family_size INTEGER DEFAULT 1,
  income_level TEXT CHECK (income_level IN ('low', 'medium', 'high')),
  employment_status TEXT CHECK (employment_status IN ('employed', 'self_employed', 'unemployed', 'retired', 'student')),
  monthly_budget NUMERIC(10,2),
  currency TEXT DEFAULT 'USD',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Receipts uploaded by users
CREATE TABLE receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  image_url TEXT,
  store_name TEXT,
  purchase_date DATE,
  total_amount NUMERIC(10,2),
  raw_text TEXT,
  ai_processed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Purchase items (from receipts or manual entry)
CREATE TABLE purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  receipt_id UUID REFERENCES receipts(id) ON DELETE SET NULL,
  item_name TEXT NOT NULL,
  category TEXT CHECK (category IN ('groceries','clothes','toys','electronics','household','health','education','other')),
  quantity NUMERIC(10,2) DEFAULT 1,
  unit_price NUMERIC(10,2),
  total_price NUMERIC(10,2),
  store_name TEXT,
  purchase_date DATE DEFAULT CURRENT_DATE,
  is_manual BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- AI-generated suggestions/insights
CREATE TABLE ai_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  suggestion_type TEXT CHECK (suggestion_type IN ('budget','savings','alternative','warning')),
  content TEXT NOT NULL,
  related_item TEXT,
  potential_savings NUMERIC(10,2),
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Scraped deals / discounts
CREATE TABLE deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name TEXT NOT NULL,
  store_name TEXT,
  original_price NUMERIC(10,2),
  discounted_price NUMERIC(10,2),
  discount_percentage NUMERIC(5,2),
  deal_url TEXT,
  category TEXT,
  valid_until DATE,
  scraped_at TIMESTAMPTZ DEFAULT NOW()
);

-- Price history for comparison
CREATE TABLE price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_name TEXT NOT NULL,
  store_name TEXT,
  price NUMERIC(10,2),
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- Row Level Security
-- ============================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_suggestions ENABLE ROW LEVEL SECURITY;

-- Profiles: users can only access their own
CREATE POLICY "Users manage own profile"
  ON profiles FOR ALL
  USING (auth.uid() = id);

-- Receipts: users can only access their own
CREATE POLICY "Users manage own receipts"
  ON receipts FOR ALL
  USING (auth.uid() = user_id);

-- Purchases: users can only access their own
CREATE POLICY "Users manage own purchases"
  ON purchases FOR ALL
  USING (auth.uid() = user_id);

-- AI Suggestions: users can only access their own
CREATE POLICY "Users manage own suggestions"
  ON ai_suggestions FOR ALL
  USING (auth.uid() = user_id);

-- Deals: public read access
CREATE POLICY "Anyone can read deals"
  ON deals FOR SELECT
  USING (true);

-- ============================================
-- Helper function: auto-update updated_at
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();