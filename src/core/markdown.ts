import matter from "gray-matter";
import type { Page, PageInput, TimelineEntry } from "../types";

/** Convert a page + metadata to Obsidian-compatible Markdown */
export function pageToMarkdown(
  page: Page,
  tags: string[],
  timelineEntries: TimelineEntry[]
): string {
  const frontmatter: Record<string, any> = {
    slug: page.slug,
    title: page.title,
    tags,
    created: page.created_at.slice(0, 10),
    updated: page.updated_at.slice(0, 10),
  };

  let body = "";

  // Compiled truth (main content)
  if (page.compiled_truth) {
    body += page.compiled_truth;
  }

  // Timeline section
  if (timelineEntries.length > 0) {
    body += "\n\n---\n\n## Timeline\n\n";
    for (const entry of timelineEntries) {
      const source = entry.source ? ` | ${entry.source}` : "";
      body += `- **${entry.date}**${source} — ${entry.summary}\n`;
    }
  }

  return matter.stringify(body.trim() + "\n", frontmatter);
}

/** Parse Obsidian Markdown file back to page data */
export function markdownToPage(content: string): {
  input: PageInput;
  timelineEntries: Omit<TimelineEntry, "id" | "page_slug">[];
} {
  const { data, content: body } = matter(content);

  const slug = data.slug || "";
  const title = data.title || "";
  const tags: string[] = Array.isArray(data.tags) ? data.tags : [];

  // Split body into compiled truth and timeline
  const timelineSeparator = /\n---\n+## Timeline\n/;
  const parts = body.split(timelineSeparator);

  const compiledTruth = (parts[0] || "").trim();
  const timelineEntries: Omit<TimelineEntry, "id" | "page_slug">[] = [];

  if (parts[1]) {
    // Parse timeline entries: - **2026-04-08** | source — summary
    const entryPattern = /^- \*\*(.+?)\*\*(?:\s*\|\s*(.+?))?\s*—\s*(.+)$/gm;
    let match: RegExpExecArray | null;
    while ((match = entryPattern.exec(parts[1])) !== null) {
      timelineEntries.push({
        date: match[1].trim(),
        source: match[2]?.trim() || "",
        summary: match[3].trim(),
      });
    }
  }

  return {
    input: {
      slug,
      title,
      compiled_truth: compiledTruth,
      tags,
    },
    timelineEntries,
  };
}

/** Extract [[wiki-links]] from content */
export function extractWikiLinks(content: string): string[] {
  const pattern = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  const links = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    links.add(match[1].trim().toLowerCase().replace(/\s+/g, "-"));
  }
  return [...links];
}
