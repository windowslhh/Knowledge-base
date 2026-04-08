import { getDb } from "./db";
import type { TimelineEntry } from "../types";

export function addTimelineEntry(entry: Omit<TimelineEntry, "id">): number {
  const db = getDb();
  const result = db.run(
    `INSERT INTO timeline_entries (page_slug, date, source, summary)
     VALUES (?, ?, ?, ?)`,
    [entry.page_slug, entry.date, entry.source, entry.summary]
  );
  return Number(result.lastInsertRowid);
}

export function getTimeline(slug: string): TimelineEntry[] {
  const db = getDb();
  return db
    .query(
      "SELECT * FROM timeline_entries WHERE page_slug = ? ORDER BY date DESC"
    )
    .all(slug) as TimelineEntry[];
}

export function deleteTimelineEntry(id: number): boolean {
  const db = getDb();
  const result = db.run("DELETE FROM timeline_entries WHERE id = ?", [id]);
  return result.changes > 0;
}

export function getRecentTimeline(limit: number = 20): TimelineEntry[] {
  const db = getDb();
  return db
    .query("SELECT * FROM timeline_entries ORDER BY date DESC LIMIT ?")
    .all(limit) as TimelineEntry[];
}
