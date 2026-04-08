import { getDb } from "./db";
import type { Link } from "../types";

export function addLink(sourceSlug: string, targetSlug: string): void {
  const db = getDb();
  db.run(
    "INSERT OR IGNORE INTO links (source_slug, target_slug) VALUES (?, ?)",
    [sourceSlug, targetSlug]
  );
}

export function removeLink(sourceSlug: string, targetSlug: string): void {
  const db = getDb();
  db.run(
    "DELETE FROM links WHERE source_slug = ? AND target_slug = ?",
    [sourceSlug, targetSlug]
  );
}

export function getLinks(slug: string): string[] {
  const db = getDb();
  const rows = db
    .query("SELECT target_slug FROM links WHERE source_slug = ? ORDER BY target_slug")
    .all(slug) as { target_slug: string }[];
  return rows.map((r) => r.target_slug);
}

export function getBacklinks(slug: string): string[] {
  const db = getDb();
  const rows = db
    .query("SELECT source_slug FROM links WHERE target_slug = ? ORDER BY source_slug")
    .all(slug) as { source_slug: string }[];
  return rows.map((r) => r.source_slug);
}

/** Parse [[wiki-links]] from content and update link table */
export function updateLinksFromContent(slug: string, content: string): void {
  const db = getDb();
  const linkPattern = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  const targets = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(content)) !== null) {
    // Normalize: lowercase, replace spaces with hyphens
    const target = match[1].trim().toLowerCase().replace(/\s+/g, "-");
    targets.add(target);
  }

  // Replace all links for this source
  db.run("DELETE FROM links WHERE source_slug = ?", [slug]);
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO links (source_slug, target_slug) VALUES (?, ?)"
  );
  for (const target of targets) {
    stmt.run(slug, target);
  }
}

export function getAllLinks(): Link[] {
  const db = getDb();
  return db.query("SELECT * FROM links ORDER BY source_slug, target_slug").all() as Link[];
}
