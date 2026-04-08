import { getDb } from "./db";
import type { SearchResult } from "../types";

export function searchFts(query: string, limit: number = 20): SearchResult[] {
  const db = getDb();

  // Escape special FTS5 characters and build query
  const safeQuery = query
    .replace(/['"]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term}"`)
    .join(" OR ");

  if (!safeQuery) return [];

  const rows = db
    .query(
      `SELECT slug, title,
              rank * -1 as score,
              snippet(page_fts, 2, '<b>', '</b>', '...', 40) as snippet
       FROM page_fts
       WHERE page_fts MATCH ?
       ORDER BY rank
       LIMIT ?`
    )
    .all(safeQuery, limit) as SearchResult[];

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
