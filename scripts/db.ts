import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config();

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and fill it in."
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export type CompanyRow = {
  id: string;
  name: string;
  category: string;
  city: string;
  address: string | null;
  rating: number | null;
  reviews_count: number;
  site: string | null;
  phone: string | null;
};

export async function upsertCompanies(rows: CompanyRow[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const row of rows) {
      await client.query(
        `INSERT INTO companies (id, name, category, city, address, rating, reviews_count, site, phone)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           category = EXCLUDED.category,
           city = EXCLUDED.city,
           address = EXCLUDED.address,
           rating = EXCLUDED.rating,
           reviews_count = EXCLUDED.reviews_count,
           site = EXCLUDED.site,
           phone = EXCLUDED.phone`,
        [
          row.id,
          row.name,
          row.category,
          row.city,
          row.address,
          row.rating,
          row.reviews_count,
          row.site,
          row.phone,
        ]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
