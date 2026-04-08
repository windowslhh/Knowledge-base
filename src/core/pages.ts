import { getDb } from "./db";
import { updateLinksFromContent } from "./links";
import type { Page, PageInput } from "../types";

export function getPage(slug: string): Page | null {
  const db = getDb();
  return db.query("SELECT * FROM pages WHERE slug = ?").get(slug) as Page | null;
}

export function putPage(input: PageInput): Page {
  const db = getDb();
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const existing = getPage(input.slug);

  if (existing) {
    db.run(
      `UPDATE pages SET title = ?, compiled_truth = ?, timeline = ?, updated_at = ? WHERE slug = ?`,
      [
        input.title,
        input.compiled_truth,
        input.timeline ?? existing.timeline,
        now,
        input.slug,
      ]
    );
  } else {
    db.run(
      `INSERT INTO pages (slug, title, compiled_truth, timeline, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [input.slug, input.title, input.compiled_truth, input.timeline ?? "", now, now]
    );
  }

  // Update FTS index
  if (existing) {
    db.run("DELETE FROM page_fts WHERE slug = ?", [input.slug]);
  }
  db.run("INSERT INTO page_fts (slug, title, content) VALUES (?, ?, ?)", [
    input.slug,
    input.title,
    input.compiled_truth,
  ]);

  // Extract and update [[wiki-links]] from content
  updateLinksFromContent(input.slug, input.compiled_truth);

  // Update tags if provided
  if (input.tags) {
    db.run("DELETE FROM tags WHERE page_slug = ?", [input.slug]);
    const insertTag = db.prepare(
      "INSERT INTO tags (page_slug, tag) VALUES (?, ?)"
    );
    for (const tag of input.tags) {
      insertTag.run(input.slug, tag);
    }
  }

  return getPage(input.slug)!;
}

export function deletePage(slug: string): boolean {
  const db = getDb();
  const existing = getPage(slug);
  if (!existing) return false;

  db.run("DELETE FROM page_fts WHERE slug = ?", [slug]);
  db.run("DELETE FROM pages WHERE slug = ?", [slug]);
  return true;
}

export function listPages(options?: {
  tag?: string;
  limit?: number;
  offset?: number;
}): Page[] {
  const db = getDb();
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  if (options?.tag) {
    return db
      .query(
        `SELECT p.* FROM pages p
         JOIN tags t ON t.page_slug = p.slug
         WHERE t.tag = ?
         ORDER BY p.updated_at DESC
         LIMIT ? OFFSET ?`
      )
      .all(options.tag, limit, offset) as Page[];
  }

  return db
    .query("SELECT * FROM pages ORDER BY updated_at DESC LIMIT ? OFFSET ?")
    .all(limit, offset) as Page[];
}

export function countPages(): number {
  const db = getDb();
  const row = db.query("SELECT COUNT(*) as count FROM pages").get() as {
    count: number;
  };
  return row.count;
}
