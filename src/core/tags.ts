import { getDb } from "./db";

export function getTagsForPage(slug: string): string[] {
  const db = getDb();
  const rows = db
    .query("SELECT tag FROM tags WHERE page_slug = ? ORDER BY tag")
    .all(slug) as { tag: string }[];
  return rows.map((r) => r.tag);
}

export function setTagsForPage(slug: string, tags: string[]): void {
  const db = getDb();
  db.run("DELETE FROM tags WHERE page_slug = ?", [slug]);
  const stmt = db.prepare("INSERT INTO tags (page_slug, tag) VALUES (?, ?)");
  for (const tag of tags) {
    stmt.run(slug, tag);
  }
}

export function addTag(slug: string, tag: string): void {
  const db = getDb();
  db.run("INSERT OR IGNORE INTO tags (page_slug, tag) VALUES (?, ?)", [
    slug,
    tag,
  ]);
}

export function removeTag(slug: string, tag: string): void {
  const db = getDb();
  db.run("DELETE FROM tags WHERE page_slug = ? AND tag = ?", [slug, tag]);
}

export function listAllTags(): { tag: string; count: number }[] {
  const db = getDb();
  return db
    .query(
      "SELECT tag, COUNT(*) as count FROM tags GROUP BY tag ORDER BY count DESC, tag"
    )
    .all() as { tag: string; count: number }[];
}

export function getPagesByTag(tag: string): string[] {
  const db = getDb();
  const rows = db
    .query("SELECT page_slug FROM tags WHERE tag = ? ORDER BY page_slug")
    .all(tag) as { page_slug: string }[];
  return rows.map((r) => r.page_slug);
}
