import type { Page, SearchResult, TimelineEntry } from "../types";

export function formatPage(
  page: Page,
  tags: string[],
  timeline: TimelineEntry[]
): string {
  let out = `# ${page.title}\n`;
  out += `slug: ${page.slug}  |  updated: ${page.updated_at}\n`;

  if (tags.length) {
    out += `tags: ${tags.join(", ")}\n`;
  }
  out += "\n";

  if (page.compiled_truth) {
    out += page.compiled_truth + "\n";
  }

  if (timeline.length > 0) {
    out += "\n--- Timeline ---\n";
    for (const entry of timeline) {
      const src = entry.source ? ` [${entry.source}]` : "";
      out += `  ${entry.date}${src} — ${entry.summary}\n`;
    }
  }

  return out;
}

export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) return "No results found.\n";

  let out = `Found ${results.length} result(s):\n\n`;
  for (const r of results) {
    out += `  ${r.slug}  (${r.score.toFixed(4)})  ${r.title}\n`;
    if (r.snippet) {
      out += `    ${r.snippet.trim()}\n`;
    }
  }
  return out;
}

export function formatPageList(
  pages: Page[],
  tags?: Map<string, string[]>
): string {
  if (pages.length === 0) return "No pages.\n";

  let out = `${pages.length} page(s):\n\n`;
  for (const p of pages) {
    const pageTags = tags?.get(p.slug);
    const tagStr = pageTags?.length ? ` [${pageTags.join(", ")}]` : "";
    out += `  ${p.slug}  — ${p.title}${tagStr}  (${p.updated_at})\n`;
  }
  return out;
}

export function formatStats(stats: {
  pages: number;
  tags: number;
  links: number;
  embeddings: number;
  timeline: number;
}): string {
  return [
    `Pages:     ${stats.pages}`,
    `Tags:      ${stats.tags}`,
    `Links:     ${stats.links}`,
    `Embeddings: ${stats.embeddings}`,
    `Timeline:  ${stats.timeline}`,
  ].join("\n");
}
