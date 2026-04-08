import { getDb } from "./db";
import type { SearchResult } from "../types";

export function searchFts(query: string, limit: number = 20): SearchResult[] {
  const db = getDb();

  const trimmed = query.trim();
  if (!trimmed) return [];

  // For trigram tokenizer: escape double quotes, use the query as-is
  // Trigram supports substring matching natively
  // Split by whitespace, search each term with OR
  const terms = trimmed
    .replace(/"/g, '""')
    .split(/\s+/)
    .filter((t) => t.length > 0);

  if (terms.length === 0) return [];

  // Build query: each term as a substring match, joined with OR
  const safeQuery = terms.map((t) => `"${t}"`).join(" OR ");

  const rows = db
    .query(
      `SELECT slug, title,
              rank * -1 as score,
              snippet(page_fts, 2, '**', '**', '…', 8) as snippet
       FROM page_fts
       WHERE page_fts MATCH ?
       ORDER BY rank
       LIMIT ?`
    )
    .all(safeQuery, limit) as SearchResult[];

  // Normalize scores to 0-1 range for display
  if (rows.length > 0) {
    const maxScore = Math.max(...rows.map((r) => r.score));
    if (maxScore > 0) {
      for (const row of rows) {
        row.score = row.score / maxScore;
      }
    }
  }

  return rows;
}

export function rebuildFtsIndex(): number {
  const db = getDb();
  db.run("DELETE FROM page_fts");
  const result = db.run(
    `INSERT INTO page_fts (slug, title, content)
     SELECT slug, title, compiled_truth FROM pages`
  );
  return result.changes;
}
