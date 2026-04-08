import { getDb } from "./db";
import type { IngestLogEntry } from "../types";

export function logIngest(
  sourcePath: string,
  pagesTouched: string[]
): number {
  const db = getDb();
  const result = db.run(
    "INSERT INTO ingest_log (source_path, pages_touched) VALUES (?, ?)",
    [sourcePath, JSON.stringify(pagesTouched)]
  );
  return Number(result.lastInsertRowid);
}

export function getIngestLog(limit: number = 20): IngestLogEntry[] {
  const db = getDb();
  const rows = db
    .query("SELECT * FROM ingest_log ORDER BY timestamp DESC LIMIT ?")
    .all(limit) as any[];
  return rows.map((r) => ({
    ...r,
    pages_touched: JSON.parse(r.pages_touched),
  }));
}

export function storeRawData(
  pageSlug: string,
  source: string,
  data: string
): number {
  const db = getDb();
  const result = db.run(
    "INSERT INTO raw_data (page_slug, source, data) VALUES (?, ?, ?)",
    [pageSlug, source, data]
  );
  return Number(result.lastInsertRowid);
}

export function getRawData(
  pageSlug: string
): { id: number; source: string; data: string }[] {
  const db = getDb();
  return db
    .query(
      "SELECT id, source, data FROM raw_data WHERE page_slug = ? ORDER BY id"
    )
    .all(pageSlug) as { id: number; source: string; data: string }[];
}
