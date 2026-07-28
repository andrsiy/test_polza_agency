import { pool, Company } from "@/lib/db";
import styles from "./companies.module.css";

export const dynamic = "force-dynamic";

type SearchParams = { q?: string; city?: string };

async function getCities(): Promise<string[]> {
  const { rows } = await pool.query<{ city: string }>(
    "SELECT DISTINCT city FROM companies ORDER BY city"
  );
  return rows.map((r) => r.city);
}

async function getCompanies(q: string, city: string): Promise<Company[]> {
  const { rows } = await pool.query<Company>(
    `SELECT id, name, category, city, address, rating, reviews_count, site, phone
     FROM companies
     WHERE ($1 = '' OR name ILIKE '%' || $1 || '%')
       AND ($2 = '' OR city = $2)
     ORDER BY name
     LIMIT 200`,
    [q, city]
  );
  return rows;
}

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const q = (params.q ?? "").trim();
  const city = (params.city ?? "").trim();

  const [cities, companies] = await Promise.all([
    getCities(),
    getCompanies(q, city),
  ]);

  return (
    <main className={styles.main}>
      <h1>Companies</h1>

      <form className={styles.filters} method="get">
        <input
          type="text"
          name="q"
          placeholder="Search by name..."
          defaultValue={q}
          className={styles.input}
        />
        <select name="city" defaultValue={city} className={styles.select}>
          <option value="">All cities</option>
          {cities.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button type="submit" className={styles.button}>
          Filter
        </button>
        {(q || city) && (
          <a href="/companies" className={styles.reset}>
            Reset
          </a>
        )}
      </form>

      <p className={styles.count}>
        {companies.length === 200
          ? "Showing first 200 matches"
          : `${companies.length} match${companies.length === 1 ? "" : "es"}`}
      </p>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th>City</th>
              <th>Address</th>
              <th>Rating</th>
              <th>Reviews</th>
              <th>Site</th>
              <th>Phone</th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.category}</td>
                <td>{c.city}</td>
                <td>{c.address ?? "—"}</td>
                <td>{c.rating ?? "—"}</td>
                <td>{c.reviews_count}</td>
                <td>
                  {c.site ? (
                    <a href={c.site} target="_blank" rel="noreferrer">
                      site
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td>{c.phone ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {companies.length === 0 && (
          <p className={styles.empty}>No companies match these filters.</p>
        )}
      </div>
    </main>
  );
}
