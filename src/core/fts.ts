import { getDb } from "./db";
import type { SearchResult } from "../types";

export function searchFts(query: string, limit: number = 20): SearchResult[] {
  const db = getDb();

  const trimmed = query.trim();
  if (!trimmed) return [];

  const terms = trimmed
    .replace(/"/g, '""')
    .split(/\s+/)
    .filter((t) => t.length > 0);

  if (terms.length === 0) return [];

  const safeQuery = terms.map((t) => `"${t}"`).join(" OR ");

  // Dual-index search: trigram (substring match, >= 3 chars) + unicode61 (token match, any length)
  // Trigram handles CJK substrings; unicode61 handles short terms (AI, GPU) and exact tokens
  const resultMap = new Map<string, SearchResult>();

  // Search trigram index (skip terms < 3 chars to avoid FTS5 error)
  const trigramTerms = terms.filter((t) => t.length >= 3);
  if (trigramTerms.length > 0) {
    const trigramQuery = trigramTerms.map((t) => `"${t}"`).join(" OR ");
    try {
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
        .all(trigramQuery, limit * 2) as SearchResult[];
      for (const row of rows) {
        resultMap.set(row.slug, row);
      }
    } catch { /* trigram search failed, continue with token search */ }
  }

  // Search unicode61 index (handles all term lengths, exact token match)
  try {
    const rows = db
      .query(
        `SELECT slug, title,
                rank * -1 as score,
                snippet(page_fts_token, 2, '**', '**', '…', 8) as snippet
         FROM page_fts_token
         WHERE page_fts_token MATCH ?
         ORDER BY rank
         LIMIT ?`
      )
      .all(safeQuery, limit * 2) as SearchResult[];
    for (const row of rows) {
      if (!resultMap.has(row.slug)) {
        resultMap.set(row.slug, row);
      }
      // If already exists from trigram, keep the one with snippet (both are valid)
    }
  } catch { /* unicode61 search failed, use trigram results only */ }

  // Merge and rank: order by original rank (results already ordered per-index)
  const merged = [...resultMap.values()];

  // Rank-based scoring: top result = 1.0, linearly decreasing
  if (merged.length > 0) {
    const n = merged.length;
    for (let i = 0; i < n; i++) {
      merged[i].score = (n - i) / n;
    }
  }

  return merged.slice(0, limit);
}

export function rebuildFtsIndex(): number {
  const db = getDb();
  // Rebuild both indexes
  db.run("DELETE FROM page_fts");
  db.run("DELETE FROM page_fts_token");
  const result = db.run(
    `INSERT INTO page_fts (slug, title, content)
     SELECT slug, title, compiled_truth FROM pages`
  );
  db.run(
    `INSERT INTO page_fts_token (slug, title, content)
     SELECT slug, title, compiled_truth FROM pages`
  );
  return result.changes;
}
