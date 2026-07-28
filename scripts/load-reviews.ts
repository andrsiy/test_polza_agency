// Loads data_pack/review.csv into the companies table.
//
// Despite its name, review.csv has the exact same columns as page_*.json
// (id,name,category,city,address,rating,reviews_count,site,phone) — there is no
// review text/author/date anywhere. It is more company records, not reviews.
// The file is also noticeably dirtier than the JSON export, so this script
// validates/normalizes every row and prints a short data-quality report instead
// of trusting the file blindly. See ANOMALIES.md for the full write-up.
//
// Usage: npm run db:load-reviews
import * as fs from "fs";
import * as path from "path";
import { parse } from "csv-parse/sync";
import * as iconv from "iconv-lite";
import { pool, upsertCompanies, CompanyRow } from "./db";

type RawRow = Record<string, string>;

// The 20 real city names, taken from the (clean) JSON export. Anything in
// review.csv that isn't already one of these gets a normalization attempt.
const CANONICAL_CITIES = [
  "Москва",
  "Санкт-Петербург",
  "Новосибирск",
  "Екатеринбург",
  "Краснодар",
  "Нижний Новгород",
  "Казань",
  "Самара",
  "Ростов-на-Дону",
  "Пермь",
  "Челябинск",
  "Волгоград",
  "Воронеж",
  "Уфа",
  "Тюмень",
  "Омск",
  "Сочи",
  "Калуга",
  "Ярославль",
  "Тула",
];
const CANONICAL_SET = new Set(CANONICAL_CITIES);
const CANONICAL_BY_LOWER = new Map(
  CANONICAL_CITIES.map((c) => [c.toLowerCase(), c])
);

// A handful of known non-Cyrillic aliases seen in review.csv.
const CITY_ALIASES: Record<string, string> = {
  Moscow: "Москва",
};

// Some review.csv city values are mojibake: UTF-8 bytes that got decoded as
// Windows-1251 and re-saved as UTF-8 upstream. Reversed generically by
// re-encoding as win1251 and decoding the resulting bytes as UTF-8, then
// checking whether the result is one of our known cities — much more robust
// than hardcoding the exact garbled byte sequence.
function repairMojibake(s: string): string | null {
  try {
    const bytes = iconv.encode(s, "win1251");
    const repaired = iconv.decode(bytes, "utf8");
    return repaired;
  } catch {
    return null;
  }
}

const PHONE_RE = /^\+7 \(\d{3}\) \d{3}-\d{2}-\d{2}$/;
const ADDRESS_LIKE_RE = /^(ул\.|просп\.|пр-т|пер\.|бул\.|наб\.)/i;
const FOREIGN_ID_RE = /^c_9\d{5}$/;

type Anomaly = { id: string; message: string };

function parseRating(raw: string, anomalies: Anomaly[], id: string): number | null {
  const s = raw.trim();
  if (s === "") return null;
  if (s.toUpperCase() === "N/A") {
    anomalies.push({ id, message: `rating "N/A" treated as missing` });
    return null;
  }
  const normalized = s.replace(",", ".");
  const n = Number(normalized);
  if (Number.isNaN(n)) {
    anomalies.push({ id, message: `rating "${raw}" is not a number, treated as missing` });
    return null;
  }
  if (n < 0 || n > 5) {
    anomalies.push({ id, message: `rating ${raw} is outside the valid 0-5 range, treated as missing` });
    return null;
  }
  if (normalized !== s) {
    anomalies.push({ id, message: `rating "${raw}" uses a comma decimal separator, normalized to ${n}` });
  }
  return n;
}

function parseReviewsCount(raw: string, anomalies: Anomaly[], id: string): number {
  const s = raw.trim();
  if (s === "") {
    anomalies.push({ id, message: `reviews_count is empty, defaulted to 0` });
    return 0;
  }
  const n = Number(s);
  if (!Number.isInteger(n)) {
    anomalies.push({ id, message: `reviews_count "${raw}" is not an integer, defaulted to 0` });
    return 0;
  }
  if (n < 0) {
    anomalies.push({ id, message: `reviews_count ${raw} is negative, defaulted to 0` });
    return 0;
  }
  return n;
}

function parsePhone(raw: string, anomalies: Anomaly[], id: string): string | null {
  const s = raw.trim();
  if (s === "") return null;
  if (!PHONE_RE.test(s)) {
    anomalies.push({ id, message: `phone "${raw}" does not match the +7 (XXX) XXX-XX-XX format, dropped` });
    return null;
  }
  return s;
}

function parseSite(raw: string): string | null {
  const s = raw.trim();
  return s === "" ? null : s;
}

function parseCity(raw: string, anomalies: Anomaly[], id: string): string {
  const trimmed = raw.trim();
  if (trimmed !== raw) {
    anomalies.push({ id, message: `city "${raw}" had stray whitespace, trimmed` });
  }

  if (CANONICAL_SET.has(trimmed)) {
    return trimmed;
  }

  if (CITY_ALIASES[trimmed]) {
    const fixed = CITY_ALIASES[trimmed];
    anomalies.push({ id, message: `city "${trimmed}" normalized to "${fixed}"` });
    return fixed;
  }

  const byLower = CANONICAL_BY_LOWER.get(trimmed.toLowerCase());
  if (byLower) {
    anomalies.push({ id, message: `city "${trimmed}" normalized to "${byLower}" (case)` });
    return byLower;
  }

  const repaired = repairMojibake(trimmed);
  if (repaired && CANONICAL_SET.has(repaired)) {
    anomalies.push({
      id,
      message: `city "${trimmed}" is mojibake, repaired to "${repaired}"`,
    });
    return repaired;
  }

  // Not an exact match, but check for a likely typo of a known city
  // (edit distance <= 2) before giving up and keeping the raw value.
  const closest = CANONICAL_CITIES.find(
    (c) => levenshtein(c.toLowerCase(), trimmed.toLowerCase()) <= 2
  );
  if (closest) {
    anomalies.push({
      id,
      message: `city "${trimmed}" looks like a typo of "${closest}", normalized`,
    });
    return closest;
  }

  anomalies.push({ id, message: `city "${trimmed}" is not one of the known cities, kept as-is` });
  return trimmed;
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...Array(b.length).fill(0),
  ]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function isBlankRow(row: RawRow): boolean {
  return Object.values(row).every((v) => v.trim() === "");
}

async function main() {
  const csvPath = path.join(__dirname, "..", "data_pack", "review.csv");
  const raw = fs.readFileSync(csvPath, "utf-8");
  const records: RawRow[] = parse(raw, { columns: true, skip_empty_lines: true });

  const anomalies: Anomaly[] = [];
  const rows: CompanyRow[] = [];
  const seenInFile = new Set<string>();

  let blankRows = 0;
  let columnShiftedRows = 0;
  let duplicateInFile = 0;
  let foreignNamespaceRows = 0;

  for (const record of records) {
    if (isBlankRow(record)) {
      blankRows++;
      continue;
    }

    const id = record.id.trim();

    // c_001015 in this file is missing its category value, which shifts every
    // later column one slot to the left: the real city ends up in `category`
    // and the real address ends up in `city`. We can detect this because the
    // "city" column then contains something that is obviously a street address.
    // The true category value is unrecoverable, so the row is dropped rather
    // than guessed at.
    if (ADDRESS_LIKE_RE.test(record.city.trim())) {
      columnShiftedRows++;
      anomalies.push({
        id: id || "(unknown)",
        message: `row appears column-shifted (city column contains an address: "${record.city}"); category is unrecoverable, row skipped`,
      });
      continue;
    }

    if (seenInFile.has(id)) {
      duplicateInFile++;
    }
    seenInFile.add(id);

    if (FOREIGN_ID_RE.test(id)) {
      foreignNamespaceRows++;
      anomalies.push({
        id,
        message: `id uses the c_9##### namespace and the name has no legal-form quoting, unlike every other record; kept but flagged for manual review`,
      });
    }

    rows.push({
      id,
      name: record.name.trim(),
      category: record.category.trim(),
      city: parseCity(record.city, anomalies, id),
      address: record.address.trim() || null,
      rating: parseRating(record.rating, anomalies, id),
      reviews_count: parseReviewsCount(record.reviews_count, anomalies, id),
      site: parseSite(record.site),
      phone: parsePhone(record.phone, anomalies, id),
    });
  }

  const idsInFile = rows.map((r) => r.id);
  const existing = await pool.query<{ id: string }>(
    "SELECT id FROM companies WHERE id = ANY($1::text[])",
    [idsInFile]
  );
  const existingIds = new Set(existing.rows.map((r) => r.id));

  await upsertCompanies(rows);
  await pool.end();

  console.log("=== review.csv load report ===");
  console.log(`Rows in file (excl. header): ${records.length}`);
  console.log(`Blank rows skipped: ${blankRows}`);
  console.log(`Column-shifted rows skipped: ${columnShiftedRows}`);
  console.log(`Rows upserted: ${rows.length}`);
  console.log(`  - already existed in companies (unchanged values): ${existingIds.size}`);
  console.log(`  - new companies added: ${rows.length - existingIds.size}`);
  console.log(`Duplicate ids within the file: ${duplicateInFile}`);
  console.log(`Rows in the suspicious c_9##### id namespace: ${foreignNamespaceRows}`);
  console.log(`Field-level anomalies fixed/flagged: ${anomalies.length}`);
  console.log("");
  for (const a of anomalies) {
    console.log(`  [${a.id}] ${a.message}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
