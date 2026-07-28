-- Three analytical queries requested in task 1.
-- Run with: psql "$DATABASE_URL" -f db/queries.sql

-- 1) Top-5 categories by number of companies.
SELECT category,
       COUNT(*) AS companies_count
FROM companies
GROUP BY category
ORDER BY companies_count DESC
LIMIT 5;

-- 2) Average rating by city, among companies with 10+ reviews.
SELECT city,
       ROUND(AVG(rating), 2) AS avg_rating,
       COUNT(*) AS companies_count
FROM companies
WHERE reviews_count >= 10
  AND rating IS NOT NULL
GROUP BY city
ORDER BY avg_rating DESC;

-- 3) Share of companies with a website, by category.
SELECT category,
       COUNT(*) AS companies_count,
       COUNT(site) AS with_site_count,
       ROUND(100.0 * COUNT(site) / COUNT(*), 1) AS with_site_pct
FROM companies
GROUP BY category
ORDER BY with_site_pct DESC;
