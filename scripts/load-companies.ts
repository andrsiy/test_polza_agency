// Loads data_pack/page_*.json (the raw API export) into the companies table.
// Usage: npm run db:load-companies
import * as fs from "fs";
import * as path from "path";
import { pool, upsertCompanies, CompanyRow } from "./db";

type SourceItem = {
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

function loadPages(dir: string): SourceItem[] {
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^page_\d+\.json$/.test(f))
    .sort();

  if (files.length === 0) {
    throw new Error(`No page_*.json files found in ${dir}`);
  }

  const items: SourceItem[] = [];
  for (const file of files) {
    const raw = fs.readFileSync(path.join(dir, file), "utf-8");
    const parsed = JSON.parse(raw);
    items.push(...parsed.items);
  }
  return items;
}

async function main() {
  const dataDir = path.join(__dirname, "..", "data_pack");
  const items = loadPages(dataDir);

  const byId = new Map<string, SourceItem>();
  for (const item of items) {
    byId.set(item.id, item); // exact duplicate ids in the source collapse to one record
  }

  const rows: CompanyRow[] = Array.from(byId.values()).map((it) => ({
    id: it.id,
    name: it.name.trim(),
    category: it.category.trim(),
    city: it.city.trim(),
    address: it.address ? it.address.trim() : null,
    rating: it.rating,
    reviews_count: it.reviews_count,
    site: it.site,
    phone: it.phone,
  }));

  await upsertCompanies(rows);

  console.log(`Read ${items.length} records from ${dataDir}`);
  console.log(`Duplicate ids collapsed: ${items.length - byId.size}`);
  console.log(`Upserted ${rows.length} unique companies.`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
