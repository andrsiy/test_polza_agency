# ANOMALIES.md — review.csv

`data_pack/review.csv` was described as "a fresh export for the same base." It isn't quite that.
Everything below was found by diffing `review.csv` against the 994 companies already loaded from
`page_*.json`, and by scripting validation for every field (`scripts/load-reviews.ts`). Detection
method is noted for each finding so it can be re-checked.

## 1. It's not "reviews" — it's more company records

The header is `id,name,category,city,address,rating,reviews_count,site,phone` — byte-for-byte the
same schema as the JSON export. There is no review text, no author, no review date, nothing that
would actually make it a "reviews" table. Loading it as a separate `reviews` table would have been
wrong; it was upserted into the same `companies` table instead.

*Detected by:* reading the CSV header and comparing it to the JSON item schema.

## 2. Six unrelated-looking records in a different id namespace

6 rows use ids like `c_900006`–`c_900011`, while every other record in both files uses `c_000001`–
`c_001200`. Their company names also break the naming convention used everywhere else: every ООО/АО
name in the rest of the corpus is quoted (`ООО «Вектор Плюс»`), but these six are bare (`АО Флагман
Лаб`, `Прайм Плюс`, `АО Сокол`, `АО Сокол Лаб`, `Модуль Строй`, `АО Орион Групп`). Nothing else about
them is malformed — they parse fine and look like real businesses — but the combination of a
disjoint id range and a different naming style is a strong signal they were pulled in from a
different source/dataset. Kept in the load (they're not invalid data), but flagged in the script
output for manual review.

*Detected by:* `grep`-ing ids against `^c_9\d{5}$` and comparing name formatting to the rest of the
file.

## 3. A row missing its category value shifts every later column

`c_001015` in the raw CSV:

```
c_001015,АО «Платформа»,Пермь,"ул. Советская, д. 89, офис 43",,4.2,77,,+7 (383) 920-78-13
```

The category is empty, so everything after it slides one column left: the real city ("Пермь") lands
in the `category` column, the real address lands in the `city` column, and `address` ends up empty.
The true category value is gone — there's no way to recover it — so this row is dropped by the loader
rather than guessed at (logged to the anomaly report).

*Detected by:* a heuristic in the loader — if the `city` column contains something that looks like a
street address (`^ул\.|просп\.|...`), the row is almost certainly shifted.

## 4. Duplicate ids inside review.csv itself

`c_001075`, `c_001049`, `c_001050` each appear twice in the file, with identical values both times.
Harmless — `ON CONFLICT (id) DO UPDATE` in the loader means the second copy just rewrites the same
values — but worth noting since a naive `INSERT` without a conflict clause would have failed.

*Detected by:* counting duplicate ids in the parsed CSV.

## 5. Two fully blank trailing rows

The last two data rows are commas with nothing between them (`,,,,,,,,`) — no header repeat, no
partial data, just blank. Skipped by the loader.

*Detected by:* checking whether every field in a row trims to an empty string.

## 6. rating: five different kinds of bad values

Raw value counts for the `rating` column included:

| raw value | count | issue |
|---|---|---|
| `N/A` | 1 | non-numeric placeholder instead of an empty cell |
| `4,5` | 1 | comma decimal separator (RU locale) instead of a dot |
| `-3` | 1 | negative, outside a 0–5 rating scale |
| `7.2` | 1 | above the 0–5 scale |
| *(empty)* | 20 | plain missing value, same as `null` in the JSON source |

The loader normalizes the comma-decimal case (`4,5` → `4.5`) and treats the rest (`N/A`, out-of-range
values) as missing rather than inserting a value that couldn't be trusted. The schema also has a
`CHECK (rating BETWEEN 0 AND 5)` constraint so out-of-range values can't silently get back in.

*Detected by:* `Counter` over the raw `rating` column, then attempting a numeric parse on every value.

## 7. reviews_count: negative, non-integer, and non-numeric values

| raw value | issue |
|---|---|
| `-10` | negative count |
| `45.5` | not an integer |
| `много` (Russian for "a lot") | not a number at all |

All three are treated as invalid and defaulted to `0` (flagged in the anomaly report) rather than
silently coerced (e.g. `Number("много")` is `NaN`, which would otherwise become `NULL` and violate the
`NOT NULL` constraint on this column).

*Detected by:* parsing every `reviews_count` value as an integer and checking the result.

## 8. phone: garbage and truncated values

- `8 (925) abc-12-34` — letters inside the number, and a domestic `8` prefix instead of `+7`.
- `+7` — truncated, no actual digits.
- 22 rows have an empty string instead of `phone` being absent — the JSON export uses `null` for a
  missing phone, the CSV uses `""`. Both are normalized to SQL `NULL`.

Values that don't match the `+7 (XXX) XXX-XX-XX` format used everywhere else are dropped (set to
`NULL`) rather than stored as unusable text.

*Detected by:* regex-matching every phone value against the format used by the ~890 well-formed phone
numbers in the JSON export.

## 9. site: same null-vs-empty-string inconsistency as phone

60 rows have `site` as an empty string rather than missing. Normalized to `NULL` on load.

## 10. city: six different spellings of two real cities

| raw value | fix |
|---|---|
| `Moscow` | → `Москва` (wrong language) |
| `москва` | → `Москва` (wrong case) |
| `Москва ` | → `Москва` (trailing space) |
| `Санкат-Петербург` | → `Санкт-Петербург` (typo) |
| `РњРѕСЃРєРІР°` | → `Москва` (mojibake) |
| `РЎР°РЅРєС‚-РџРµС‚РµСЂР±СѓСЂРг` | → `Санкт-Петербург` (mojibake) |

The two garbled strings are UTF-8 text that got decoded as Windows-1251 and re-saved as UTF-8
somewhere upstream — a classic mojibake round-trip (verified by re-encoding the garbled string as
`windows-1251` and decoding the resulting bytes as UTF-8, which recovers the original Cyrillic text
exactly). Left uncorrected, a naive `GROUP BY city` would have produced 6 phantom "cities" instead of
the real 2, which would have directly skewed the "average rating by city" query from task 1.

*Detected by:* `Counter` over the raw `city` column and eyeballing anything that wasn't one of the 20
known city names from the JSON export; the mojibake strings were confirmed by round-tripping them
through the cp1251 codec.

## Net effect on the database

- 207 data rows in the file → 2 blank rows and 1 column-shifted row dropped → 204 rows validated and
  upserted.
- Of those 204: 6 already existed (identical values, no-op update), 3 were duplicates of each other
  within the file, leaving **195 genuinely new companies** added to `companies` (994 → 1189 total).
- 6 rows kept but flagged as likely originating from a different source (see §2).

Run `npm run db:load-reviews` to reproduce — it prints this same report (row counts + a line per
fixed/flagged field) to stdout.
