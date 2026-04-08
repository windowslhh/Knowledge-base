import { join, dirname, relative } from "path";
import { existsSync, mkdirSync, statSync, readdirSync, unlinkSync } from "fs";
import { getDb } from "./db";
import { getPage, putPage, listPages } from "./pages";
import { getTagsForPage, setTagsForPage } from "./tags";
import { getTimeline, addTimelineEntry } from "./timeline";
import { updateLinksFromContent } from "./links";
import { pageToMarkdown, markdownToPage } from "./markdown";
import type { SyncDirection, SyncResult, Page } from "../types";

let _wikiDir: string | null = null;

export function getWikiDir(baseDir?: string): string {
  if (_wikiDir) return _wikiDir;
  return join(baseDir ?? process.cwd(), "wiki");
}

export function setWikiDir(dir: string): void {
  _wikiDir = dir;
}

/** Convert slug to file path: "people/jensen-huang" → "wiki/people/jensen-huang.md" */
function slugToPath(slug: string): string {
  return join(getWikiDir(), `${slug}.md`);
}

/** Convert file path to slug: "wiki/people/jensen-huang.md" → "people/jensen-huang" */
function pathToSlug(filePath: string): string {
  const rel = relative(getWikiDir(), filePath);
  return rel.replace(/\.md$/, "").replace(/\\/g, "/");
}

/** Export a single page from SQLite to wiki/ as Markdown */
export function syncPageToFile(slug: string): boolean {
  const page = getPage(slug);
  if (!page) return false;

  const tags = getTagsForPage(slug);
  const timeline = getTimeline(slug);
  const md = pageToMarkdown(page, tags, timeline);

  const filePath = slugToPath(slug);
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  Bun.write(filePath, md);
  return true;
}

/** Import a single Markdown file from wiki/ into SQLite */
export async function syncFileToDbAsync(filePath: string): Promise<string | null> {
  const content = await Bun.file(filePath).text();
  return syncFileContentToDb(filePath, content);
}

function syncFileContentToDb(filePath: string, content: string): string | null {
  if (!content) return null;

  const parsed = markdownToPage(content);
  const slug = parsed.input.slug || pathToSlug(filePath);

  if (!slug) return null;

  // Ensure slug is set
  parsed.input.slug = slug;

  // Put page (creates or updates)
  putPage(parsed.input);

  // Set tags
  if (parsed.input.tags) {
    setTagsForPage(slug, parsed.input.tags);
  }

  // Sync timeline entries
  const db = getDb();
  db.run("DELETE FROM timeline_entries WHERE page_slug = ?", [slug]);
  for (const entry of parsed.timelineEntries) {
    addTimelineEntry({ ...entry, page_slug: slug });
  }

  // Update wiki links from content
  updateLinksFromContent(slug, parsed.input.compiled_truth);

  return slug;
}

/** Scan wiki/ directory for all .md files */
function scanWikiFiles(): string[] {
  const wikiDir = getWikiDir();
  if (!existsSync(wikiDir)) return [];

  const files: string[] = [];

  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith(".md") && entry.name !== ".gitkeep") {
        // Skip system files
        const rel = relative(wikiDir, fullPath);
        if (rel !== "index.md" && rel !== "log.md") {
          files.push(fullPath);
        }
      }
    }
  }

  walk(wikiDir);
  return files;
}

/** Full bidirectional sync */
export async function sync(
  direction: SyncDirection = "both"
): Promise<SyncResult> {
  const result: SyncResult = { exported: [], imported: [], conflicts: [] };

  if (direction === "to_wiki" || direction === "both") {
    // Export all pages from SQLite to wiki/
    const pages = listPages({ limit: 10000 });
    for (const page of pages) {
      syncPageToFile(page.slug);
      result.exported.push(page.slug);
    }
  }

  if (direction === "from_wiki" || direction === "both") {
    // Import modified files from wiki/ to SQLite
    const files = scanWikiFiles();
    for (const filePath of files) {
      const slug = await syncFileToDbAsync(filePath);
      if (slug) {
        result.imported.push(slug);
      }
    }
  }

  return result;
}

/** Export all pages and generate index.md */
export async function exportAll(): Promise<number> {
  const pages = listPages({ limit: 10000 });
  let count = 0;

  for (const page of pages) {
    if (syncPageToFile(page.slug)) count++;
  }

  // Generate index.md
  await generateIndex(pages);

  return count;
}

/** Generate wiki/index.md — a table of contents for Obsidian */
async function generateIndex(pages: Page[]): Promise<void> {
  const wikiDir = getWikiDir();

  // Group pages by category (first part of slug)
  const groups = new Map<string, Page[]>();
  for (const page of pages) {
    const parts = page.slug.split("/");
    const category = parts.length > 1 ? parts[0] : "uncategorized";
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category)!.push(page);
  }

  let content = "# Knowledge Base Index\n\n";
  content += `> Auto-generated. ${pages.length} pages total.\n\n`;

  for (const [category, categoryPages] of [...groups.entries()].sort()) {
    content += `## ${category}\n\n`;
    for (const page of categoryPages.sort((a, b) =>
      a.title.localeCompare(b.title)
    )) {
      content += `- [[${page.slug}|${page.title}]]\n`;
    }
    content += "\n";
  }

  await Bun.write(join(wikiDir, "index.md"), content);
}
