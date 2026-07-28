-- Schema for the companies directory (Polza test task, task 1).
-- Run with: psql "$DATABASE_URL" -f db/schema.sql

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS companies (
    id             TEXT PRIMARY KEY,           -- natural id from the source API, e.g. c_000123
    name           TEXT NOT NULL,
    category       TEXT NOT NULL,
    city           TEXT NOT NULL,
    address        TEXT,
    rating         NUMERIC(2,1) CHECK (rating >= 0 AND rating <= 5),
    reviews_count  INTEGER NOT NULL DEFAULT 0 CHECK (reviews_count >= 0),
    site           TEXT,
    phone          TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Filters used by the top-5 categories / city aggregation queries and by the /companies page.
CREATE INDEX IF NOT EXISTS idx_companies_category ON companies (category);
CREATE INDEX IF NOT EXISTS idx_companies_city ON companies (city);

-- Trigram index so ILIKE '%term%' name search (used by the /companies page) can use an index
-- instead of a sequential scan.
CREATE INDEX IF NOT EXISTS idx_companies_name_trgm ON companies USING gin (name gin_trgm_ops);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_companies_updated_at ON companies;
CREATE TRIGGER trg_companies_updated_at
    BEFORE UPDATE ON companies
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
