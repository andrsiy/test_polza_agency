import { Pool } from "pg";

// Reuse a single pool across hot-reloads in dev instead of opening a new one
// on every request / file change.
const globalForPg = globalThis as unknown as { pgPool?: Pool };

export const pool =
  globalForPg.pgPool ??
  new Pool({ connectionString: process.env.DATABASE_URL });

if (process.env.NODE_ENV !== "production") {
  globalForPg.pgPool = pool;
}

export type Company = {
  id: string;
  name: string;
  category: string;
  city: string;
  address: string | null;
  rating: string | null; // numeric comes back as string from node-postgres
  reviews_count: number;
  site: string | null;
  phone: string | null;
};
