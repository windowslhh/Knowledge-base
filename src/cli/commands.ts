import { readFileSync } from "fs";
import {
  openDb,
  getDb,
  getPage,
  putPage,
  deletePage,
  listPages,
  countPages,
  searchFts,
  rebuildFtsIndex,
  getTagsForPage,
  setTagsForPage,
  listAllTags,
  addLink,
  getBacklinks,
  getLinks,
  getTimeline,
  addTimelineEntry,
  storeEmbedding,
  deleteEmbeddings,
  getAllLinks,
  syncPageToFile,
  sync,
  exportAll,
} from "../core/index";
import { hybridSearch } from "../search/hybrid";
import { createProvider } from "../embeddings/index";
import {
  formatPage,
  formatSearchResults,
  formatPageList,
  formatStats,
} from "./format";

function ensureDb() {
  openDb();
}

export async function cmdGet(slug: string) {
  ensureDb();
  const page = getPage(slug);
  if (!page) {
    console.error(`Page not found: ${slug}`);
    process.exit(1);
  }
  const tags = getTagsForPage(slug);
  const timeline = getTimeline(slug);
  console.log(formatPage(page, tags, timeline));
}

export async function cmdPut(
  slug: string,
  options: { title?: string; file?: string; tags?: string }
) {
  ensureDb();
  let compiledTruth = "";

  if (options.file) {
    compiledTruth = readFileSync(options.file, "utf-8");
  } else {
    // Read from stdin
    compiledTruth = await Bun.stdin.text();
  }

  const title = options.title ?? slug.split("/").pop()!.replace(/-/g, " ");
  const tags = options.tags?.split(",").map((t) => t.trim()) ?? [];

  const page = putPage({ slug, title, compiled_truth: compiledTruth, tags });
  syncPageToFile(slug);
  console.log(`Saved: ${page.slug} (${page.updated_at})`);
}

export function cmdDelete(slug: string) {
  ensureDb();
  if (deletePage(slug)) {
    console.log(`Deleted: ${slug}`);
  } else {
    console.error(`Page not found: ${slug}`);
    process.exit(1);
  }
}

export function cmdList(options: { tag?: string; limit?: string }) {
  ensureDb();
  const limit = options.limit ? parseInt(options.limit) : 50;
  const pages = listPages({ tag: options.tag, limit });
  const tagMap = new Map<string, string[]>();
  for (const p of pages) {
    tagMap.set(p.slug, getTagsForPage(p.slug));
  }
  console.log(formatPageList(pages, tagMap));
}

export function cmdSearch(query: string) {
  ensureDb();
  const results = searchFts(query);
  console.log(formatSearchResults(results));
}

export async function cmdQuery(question: string, options: { limit?: string }) {
  ensureDb();
  const provider = createProvider();
  const results = await hybridSearch(
    {
      query: question,
      limit: options.limit ? parseInt(options.limit) : 10,
    },
    provider
  );
  console.log(formatSearchResults(results));
}

export function cmdLink(source: string, target: string) {
  ensureDb();
  addLink(source, target);
  console.log(`Linked: ${source} → ${target}`);
}

export function cmdBacklinks(slug: string) {
  ensureDb();
  const backlinks = getBacklinks(slug);
  if (backlinks.length === 0) {
    console.log("No backlinks found.");
  } else {
    console.log(`Backlinks to ${slug}:\n`);
    for (const b of backlinks) {
      console.log(`  ← ${b}`);
    }
  }
}

export function cmdTags(slug?: string) {
  ensureDb();
  if (slug) {
    const tags = getTagsForPage(slug);
    console.log(tags.length ? tags.join(", ") : "No tags.");
  } else {
    const allTags = listAllTags();
    if (allTags.length === 0) {
      console.log("No tags.");
    } else {
      for (const t of allTags) {
        console.log(`  ${t.tag} (${t.count})`);
      }
    }
  }
}

export function cmdTimeline(slug: string) {
  ensureDb();
  const entries = getTimeline(slug);
  if (entries.length === 0) {
    console.log("No timeline entries.");
  } else {
    for (const e of entries) {
      const src = e.source ? ` [${e.source}]` : "";
      console.log(`  ${e.date}${src} — ${e.summary}`);
    }
  }
}

export async function cmdImport(path: string) {
  ensureDb();
  const content = readFileSync(path, "utf-8");
  const { markdownToPage } = await import("../core/markdown");
  const parsed = markdownToPage(content);

  if (!parsed.input.slug) {
    parsed.input.slug = path
      .replace(/\.md$/, "")
      .replace(/\\/g, "/")
      .split("/")
      .pop()!;
  }

  putPage(parsed.input);

  if (parsed.timelineEntries.length > 0) {
    for (const entry of parsed.timelineEntries) {
      addTimelineEntry({ ...entry, page_slug: parsed.input.slug });
    }
  }

  syncPageToFile(parsed.input.slug);
  console.log(`Imported: ${parsed.input.slug}`);
}

export async function cmdExport(options: { all?: boolean }) {
  ensureDb();
  const count = await exportAll();
  console.log(`Exported ${count} pages to wiki/`);
}

export async function cmdEmbed(slug: string) {
  ensureDb();
  const page = getPage(slug);
  if (!page) {
    console.error(`Page not found: ${slug}`);
    process.exit(1);
  }

  const provider = createProvider();
  if (!provider) {
    console.error(
      "No embedding provider configured. Set EMBEDDING_PROVIDER env var or use config."
    );
    process.exit(1);
  }

  const text = `${page.title}\n\n${page.compiled_truth}`;

  // Chunk text (~512 tokens ≈ 2000 chars)
  const CHUNK_SIZE = 2000;
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    chunks.push(text.slice(i, i + CHUNK_SIZE));
  }

  deleteEmbeddings(slug);
  const vectors = await provider.embedBatch(chunks);
  for (let i = 0; i < vectors.length; i++) {
    storeEmbedding(slug, i, vectors[i]);
  }

  console.log(
    `Embedded: ${slug} (${chunks.length} chunk(s), ${provider.name}/${provider.dimensions}d)`
  );
}

export async function cmdSync(options: {
  direction?: string;
}) {
  ensureDb();
  const direction = (options.direction ?? "both") as any;
  const result = await sync(direction);
  console.log(
    `Sync complete: ${result.exported.length} exported, ${result.imported.length} imported`
  );
}

export function cmdStats() {
  ensureDb();
  const db = getDb();

  const pages = countPages();
  const tags =
    (
      db.query("SELECT COUNT(DISTINCT tag) as c FROM tags").get() as {
        c: number;
      }
    )?.c ?? 0;
  const links =
    (
      db.query("SELECT COUNT(*) as c FROM links").get() as { c: number }
    )?.c ?? 0;
  const embeddings =
    (
      db
        .query("SELECT COUNT(DISTINCT page_slug) as c FROM embeddings")
        .get() as { c: number }
    )?.c ?? 0;
  const timeline =
    (
      db.query("SELECT COUNT(*) as c FROM timeline_entries").get() as {
        c: number;
      }
    )?.c ?? 0;

  console.log(formatStats({ pages, tags, links, embeddings, timeline }));
}

export async function cmdServe() {
  // Dynamically import MCP server
  const { startServer } = await import("../mcp/index");
  await startServer();
}
