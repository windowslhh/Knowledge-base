import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { openDb, closeDb, getDb, getConfig, setConfig } from "../core/db";
import { getPage, putPage, deletePage, listPages, countPages } from "../core/pages";
import { getTagsForPage, setTagsForPage, addTag, removeTag, listAllTags, getPagesByTag } from "../core/tags";
import { addTimelineEntry, getTimeline, deleteTimelineEntry, getRecentTimeline } from "../core/timeline";
import { logIngest, getIngestLog, storeRawData, getRawData } from "../core/ingest-log";
import { searchFts, rebuildFtsIndex } from "../core/fts";
import { addLink, removeLink, getLinks, getBacklinks, updateLinksFromContent, getAllLinks } from "../core/links";
import { storeEmbedding, getEmbeddings, deleteEmbeddings, cosineSimilarity, searchByVector } from "../core/embeddings";
import { pageToMarkdown, markdownToPage, extractWikiLinks } from "../core/markdown";
import { syncPageToFile, syncFileToDbAsync, sync, exportAll, setWikiDir, getWikiDir } from "../core/sync";
import { hybridSearch } from "../search/hybrid";

let tmpDir: string;
let dbPath: string;
let wikiDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "gbrain-test-"));
  dbPath = join(tmpDir, "test.db");
  wikiDir = join(tmpDir, "wiki");
  openDb(dbPath);
  setWikiDir(wikiDir);
});

afterEach(() => {
  closeDb();
  setWikiDir(null as any); // reset
  rmSync(tmpDir, { recursive: true, force: true });
});

// ==================== DB ====================
describe("db", () => {
  test("openDb creates database and schema", () => {
    const db = getDb();
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("pages");
    expect(names).toContain("tags");
    expect(names).toContain("links");
    expect(names).toContain("embeddings");
    expect(names).toContain("config");
    expect(names).toContain("timeline_entries");
    expect(names).toContain("ingest_log");
    expect(names).toContain("raw_data");
  });

  test("schema_version is set", () => {
    expect(getConfig("schema_version")).toBe("2");
  });

  test("config get/set", () => {
    setConfig("test_key", "test_value");
    expect(getConfig("test_key")).toBe("test_value");
    setConfig("test_key", "updated");
    expect(getConfig("test_key")).toBe("updated");
  });

  test("getConfig returns null for missing key", () => {
    expect(getConfig("nonexistent")).toBeNull();
  });

  test("WAL mode is enabled", () => {
    const db = getDb();
    const row = db.query("PRAGMA journal_mode").get() as { journal_mode: string };
    expect(row.journal_mode).toBe("wal");
  });
});

// ==================== Pages ====================
describe("pages", () => {
  test("putPage creates a new page", () => {
    const page = putPage({
      slug: "test/hello",
      title: "Hello World",
      compiled_truth: "This is a test page.",
    });
    expect(page.slug).toBe("test/hello");
    expect(page.title).toBe("Hello World");
    expect(page.compiled_truth).toBe("This is a test page.");
    expect(page.created_at).toBeTruthy();
    expect(page.updated_at).toBeTruthy();
  });

  test("getPage returns the page", () => {
    putPage({ slug: "test/a", title: "A", compiled_truth: "Content A" });
    const page = getPage("test/a");
    expect(page).not.toBeNull();
    expect(page!.title).toBe("A");
  });

  test("getPage returns null for nonexistent", () => {
    expect(getPage("nonexistent")).toBeNull();
  });

  test("putPage updates existing page", () => {
    putPage({ slug: "test/upd", title: "V1", compiled_truth: "Old" });
    const updated = putPage({ slug: "test/upd", title: "V2", compiled_truth: "New" });
    expect(updated.title).toBe("V2");
    expect(updated.compiled_truth).toBe("New");
    expect(countPages()).toBe(1);
  });

  test("putPage with tags", () => {
    putPage({ slug: "test/tagged", title: "Tagged", compiled_truth: "", tags: ["alpha", "beta"] });
    const tags = getTagsForPage("test/tagged");
    expect(tags).toEqual(["alpha", "beta"]);
  });

  test("putPage updates tags on re-put", () => {
    putPage({ slug: "test/t", title: "T", compiled_truth: "", tags: ["a", "b"] });
    putPage({ slug: "test/t", title: "T", compiled_truth: "", tags: ["c"] });
    expect(getTagsForPage("test/t")).toEqual(["c"]);
  });

  test("deletePage removes page", () => {
    putPage({ slug: "test/del", title: "Del", compiled_truth: "" });
    expect(deletePage("test/del")).toBe(true);
    expect(getPage("test/del")).toBeNull();
  });

  test("deletePage returns false for nonexistent", () => {
    expect(deletePage("nonexistent")).toBe(false);
  });

  test("deletePage cascades to tags", () => {
    putPage({ slug: "test/cas", title: "Cas", compiled_truth: "", tags: ["x"] });
    deletePage("test/cas");
    expect(getTagsForPage("test/cas")).toEqual([]);
  });

  test("listPages returns all pages", () => {
    putPage({ slug: "test/a", title: "A", compiled_truth: "" });
    putPage({ slug: "test/b", title: "B", compiled_truth: "" });
    putPage({ slug: "test/c", title: "C", compiled_truth: "" });
    const pages = listPages();
    expect(pages.length).toBe(3);
    expect(pages.map((p) => p.slug).sort()).toEqual(["test/a", "test/b", "test/c"]);
  });

  test("listPages with tag filter", () => {
    putPage({ slug: "test/x", title: "X", compiled_truth: "", tags: ["go"] });
    putPage({ slug: "test/y", title: "Y", compiled_truth: "", tags: ["rust"] });
    putPage({ slug: "test/z", title: "Z", compiled_truth: "", tags: ["go"] });
    const goPages = listPages({ tag: "go" });
    expect(goPages.length).toBe(2);
    expect(goPages.map((p) => p.slug).sort()).toEqual(["test/x", "test/z"]);
  });

  test("listPages with limit and offset", () => {
    for (let i = 0; i < 10; i++) {
      putPage({ slug: `test/p${i}`, title: `P${i}`, compiled_truth: "" });
    }
    const page1 = listPages({ limit: 3, offset: 0 });
    const page2 = listPages({ limit: 3, offset: 3 });
    expect(page1.length).toBe(3);
    expect(page2.length).toBe(3);
    expect(page1[0].slug).not.toBe(page2[0].slug);
  });

  test("countPages", () => {
    expect(countPages()).toBe(0);
    putPage({ slug: "test/1", title: "1", compiled_truth: "" });
    putPage({ slug: "test/2", title: "2", compiled_truth: "" });
    expect(countPages()).toBe(2);
  });
});

// ==================== Tags ====================
describe("tags", () => {
  test("setTagsForPage and getTagsForPage", () => {
    putPage({ slug: "test/t", title: "T", compiled_truth: "" });
    setTagsForPage("test/t", ["c", "a", "b"]);
    expect(getTagsForPage("test/t")).toEqual(["a", "b", "c"]); // sorted
  });

  test("addTag and removeTag", () => {
    putPage({ slug: "test/t", title: "T", compiled_truth: "" });
    addTag("test/t", "new");
    expect(getTagsForPage("test/t")).toContain("new");
    removeTag("test/t", "new");
    expect(getTagsForPage("test/t")).not.toContain("new");
  });

  test("addTag is idempotent", () => {
    putPage({ slug: "test/t", title: "T", compiled_truth: "" });
    addTag("test/t", "dup");
    addTag("test/t", "dup");
    expect(getTagsForPage("test/t")).toEqual(["dup"]);
  });

  test("listAllTags with counts", () => {
    putPage({ slug: "test/a", title: "A", compiled_truth: "", tags: ["x", "y"] });
    putPage({ slug: "test/b", title: "B", compiled_truth: "", tags: ["x"] });
    const all = listAllTags();
    expect(all.find((t) => t.tag === "x")?.count).toBe(2);
    expect(all.find((t) => t.tag === "y")?.count).toBe(1);
  });

  test("getPagesByTag", () => {
    putPage({ slug: "test/a", title: "A", compiled_truth: "", tags: ["lang"] });
    putPage({ slug: "test/b", title: "B", compiled_truth: "", tags: ["lang"] });
    putPage({ slug: "test/c", title: "C", compiled_truth: "", tags: ["other"] });
    expect(getPagesByTag("lang").sort()).toEqual(["test/a", "test/b"]);
  });
});

// ==================== Timeline ====================
describe("timeline", () => {
  test("add and get timeline entries", () => {
    putPage({ slug: "test/t", title: "T", compiled_truth: "" });
    addTimelineEntry({ page_slug: "test/t", date: "2026-01-01", source: "src.pdf", summary: "Event 1" });
    addTimelineEntry({ page_slug: "test/t", date: "2026-02-01", source: "", summary: "Event 2" });
    const entries = getTimeline("test/t");
    expect(entries.length).toBe(2);
    expect(entries[0].date).toBe("2026-02-01"); // DESC order
    expect(entries[1].summary).toBe("Event 1");
  });

  test("deleteTimelineEntry", () => {
    putPage({ slug: "test/t", title: "T", compiled_truth: "" });
    const id = addTimelineEntry({ page_slug: "test/t", date: "2026-01-01", source: "", summary: "Del" });
    expect(deleteTimelineEntry(id)).toBe(true);
    expect(getTimeline("test/t").length).toBe(0);
  });

  test("deleteTimelineEntry returns false for nonexistent", () => {
    expect(deleteTimelineEntry(99999)).toBe(false);
  });

  test("getRecentTimeline across pages", () => {
    putPage({ slug: "test/a", title: "A", compiled_truth: "" });
    putPage({ slug: "test/b", title: "B", compiled_truth: "" });
    addTimelineEntry({ page_slug: "test/a", date: "2026-01-01", source: "", summary: "A1" });
    addTimelineEntry({ page_slug: "test/b", date: "2026-03-01", source: "", summary: "B1" });
    const recent = getRecentTimeline(10);
    expect(recent.length).toBe(2);
    expect(recent[0].summary).toBe("B1"); // most recent
  });
});

// ==================== Ingest Log ====================
describe("ingest-log", () => {
  test("logIngest and getIngestLog", () => {
    putPage({ slug: "test/p", title: "P", compiled_truth: "" });
    logIngest("sources/doc.pdf", ["test/p"]);
    const log = getIngestLog();
    expect(log.length).toBe(1);
    expect(log[0].source_path).toBe("sources/doc.pdf");
    expect(log[0].pages_touched).toEqual(["test/p"]);
  });

  test("storeRawData and getRawData", () => {
    putPage({ slug: "test/p", title: "P", compiled_truth: "" });
    storeRawData("test/p", "doc.pdf", "raw content here");
    const data = getRawData("test/p");
    expect(data.length).toBe(1);
    expect(data[0].source).toBe("doc.pdf");
    expect(data[0].data).toBe("raw content here");
  });

  test("multiple raw data entries", () => {
    putPage({ slug: "test/p", title: "P", compiled_truth: "" });
    storeRawData("test/p", "src1", "data1");
    storeRawData("test/p", "src2", "data2");
    expect(getRawData("test/p").length).toBe(2);
  });
});

// ==================== FTS ====================
describe("fts", () => {
  test("searchFts finds page by content", () => {
    putPage({ slug: "test/gpu", title: "GPU Architecture", compiled_truth: "CUDA cores and tensor processing units" });
    const results = searchFts("CUDA");
    expect(results.length).toBe(1);
    expect(results[0].slug).toBe("test/gpu");
  });

  test("searchFts finds page by title", () => {
    putPage({ slug: "test/gpu", title: "GPU Architecture", compiled_truth: "content here" });
    const results = searchFts("GPU");
    expect(results.length).toBe(1);
  });

  test("searchFts returns empty for no match", () => {
    putPage({ slug: "test/a", title: "Alpha", compiled_truth: "bravo" });
    expect(searchFts("zzznonexistent")).toEqual([]);
  });

  test("searchFts handles empty query", () => {
    expect(searchFts("")).toEqual([]);
    expect(searchFts("   ")).toEqual([]);
  });

  test("searchFts respects limit", () => {
    for (let i = 0; i < 5; i++) {
      putPage({ slug: `test/p${i}`, title: `Page ${i}`, compiled_truth: "common keyword" });
    }
    const results = searchFts("common", 2);
    expect(results.length).toBe(2);
  });

  test("searchFts with multiple terms (OR)", () => {
    putPage({ slug: "test/a", title: "Alpha", compiled_truth: "cat" });
    putPage({ slug: "test/b", title: "Beta", compiled_truth: "dog" });
    const results = searchFts("cat dog");
    expect(results.length).toBe(2);
  });

  test("rebuildFtsIndex", () => {
    putPage({ slug: "test/a", title: "A", compiled_truth: "content" });
    // Manually corrupt FTS
    getDb().run("DELETE FROM page_fts");
    expect(searchFts("content").length).toBe(0);
    rebuildFtsIndex();
    expect(searchFts("content").length).toBe(1);
  });

  test("FTS stays in sync after update", () => {
    putPage({ slug: "test/u", title: "U", compiled_truth: "original" });
    expect(searchFts("original").length).toBe(1);
    putPage({ slug: "test/u", title: "U", compiled_truth: "replaced" });
    expect(searchFts("original").length).toBe(0);
    expect(searchFts("replaced").length).toBe(1);
  });

  test("FTS cleaned up after delete", () => {
    putPage({ slug: "test/d", title: "D", compiled_truth: "findme" });
    expect(searchFts("findme").length).toBe(1);
    deletePage("test/d");
    expect(searchFts("findme").length).toBe(0);
  });
});

// ==================== Links ====================
describe("links", () => {
  test("addLink and getLinks", () => {
    putPage({ slug: "test/a", title: "A", compiled_truth: "" });
    putPage({ slug: "test/b", title: "B", compiled_truth: "" });
    addLink("test/a", "test/b");
    expect(getLinks("test/a")).toEqual(["test/b"]);
  });

  test("getBacklinks", () => {
    putPage({ slug: "test/a", title: "A", compiled_truth: "" });
    putPage({ slug: "test/b", title: "B", compiled_truth: "" });
    addLink("test/a", "test/b");
    expect(getBacklinks("test/b")).toEqual(["test/a"]);
  });

  test("removeLink", () => {
    putPage({ slug: "test/a", title: "A", compiled_truth: "" });
    putPage({ slug: "test/b", title: "B", compiled_truth: "" });
    addLink("test/a", "test/b");
    removeLink("test/a", "test/b");
    expect(getLinks("test/a")).toEqual([]);
  });

  test("addLink is idempotent", () => {
    putPage({ slug: "test/a", title: "A", compiled_truth: "" });
    putPage({ slug: "test/b", title: "B", compiled_truth: "" });
    addLink("test/a", "test/b");
    addLink("test/a", "test/b");
    expect(getLinks("test/a")).toEqual(["test/b"]);
  });

  test("updateLinksFromContent parses [[wiki-links]]", () => {
    putPage({ slug: "test/src", title: "Src", compiled_truth: "" });
    updateLinksFromContent("test/src", "See [[test/target-a]] and [[test/target-b|Display Text]]");
    const links = getLinks("test/src");
    expect(links.sort()).toEqual(["test/target-a", "test/target-b"]);
  });

  test("updateLinksFromContent replaces old links", () => {
    putPage({ slug: "test/src", title: "Src", compiled_truth: "" });
    updateLinksFromContent("test/src", "See [[old-link]]");
    expect(getLinks("test/src")).toEqual(["old-link"]);
    updateLinksFromContent("test/src", "See [[new-link]]");
    expect(getLinks("test/src")).toEqual(["new-link"]);
  });

  test("updateLinksFromContent handles no links", () => {
    putPage({ slug: "test/src", title: "Src", compiled_truth: "" });
    updateLinksFromContent("test/src", "No links here.");
    expect(getLinks("test/src")).toEqual([]);
  });

  test("getAllLinks", () => {
    putPage({ slug: "test/a", title: "A", compiled_truth: "" });
    putPage({ slug: "test/b", title: "B", compiled_truth: "" });
    addLink("test/a", "test/b");
    addLink("test/b", "test/a");
    const all = getAllLinks();
    expect(all.length).toBe(2);
  });
});

// ==================== Embeddings ====================
describe("embeddings", () => {
  test("storeEmbedding and getEmbeddings", () => {
    putPage({ slug: "test/e", title: "E", compiled_truth: "" });
    const vec = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    storeEmbedding("test/e", 0, vec);
    const chunks = getEmbeddings("test/e");
    expect(chunks.length).toBe(1);
    expect(chunks[0].chunk_index).toBe(0);
    expect(chunks[0].vector.length).toBe(4);
    expect(Math.abs(chunks[0].vector[0] - 0.1)).toBeLessThan(0.001);
  });

  test("multiple chunks", () => {
    putPage({ slug: "test/e", title: "E", compiled_truth: "" });
    storeEmbedding("test/e", 0, new Float32Array([1, 0, 0]));
    storeEmbedding("test/e", 1, new Float32Array([0, 1, 0]));
    expect(getEmbeddings("test/e").length).toBe(2);
  });

  test("deleteEmbeddings", () => {
    putPage({ slug: "test/e", title: "E", compiled_truth: "" });
    storeEmbedding("test/e", 0, new Float32Array([1, 0]));
    deleteEmbeddings("test/e");
    expect(getEmbeddings("test/e").length).toBe(0);
  });

  test("cosineSimilarity identical vectors = 1", () => {
    const v = new Float32Array([1, 2, 3]);
    expect(Math.abs(cosineSimilarity(v, v) - 1.0)).toBeLessThan(0.001);
  });

  test("cosineSimilarity orthogonal vectors = 0", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(Math.abs(cosineSimilarity(a, b))).toBeLessThan(0.001);
  });

  test("cosineSimilarity different lengths = 0", () => {
    const a = new Float32Array([1, 2]);
    const b = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  test("cosineSimilarity zero vector = 0", () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([1, 2, 3]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  test("searchByVector returns ranked results", () => {
    putPage({ slug: "test/a", title: "A", compiled_truth: "" });
    putPage({ slug: "test/b", title: "B", compiled_truth: "" });
    storeEmbedding("test/a", 0, new Float32Array([1, 0, 0]));
    storeEmbedding("test/b", 0, new Float32Array([0, 1, 0]));
    const results = searchByVector(new Float32Array([1, 0, 0]), 10);
    expect(results.length).toBe(2);
    expect(results[0].slug).toBe("test/a");
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });
});

// ==================== Markdown ====================
describe("markdown", () => {
  test("pageToMarkdown produces valid frontmatter", () => {
    const md = pageToMarkdown(
      {
        slug: "people/test",
        title: "Test Person",
        compiled_truth: "A test person.",
        timeline: "",
        created_at: "2026-04-08 12:00:00",
        updated_at: "2026-04-08 13:00:00",
      },
      ["person", "test"],
      []
    );
    expect(md).toContain("slug: people/test");
    expect(md).toContain("title: Test Person");
    expect(md).toContain("A test person.");
    expect(md).toContain("created: '2026-04-08'");
  });

  test("pageToMarkdown includes timeline", () => {
    const md = pageToMarkdown(
      {
        slug: "test/t",
        title: "T",
        compiled_truth: "Body.",
        timeline: "",
        created_at: "2026-01-01 00:00:00",
        updated_at: "2026-01-01 00:00:00",
      },
      [],
      [
        { id: 1, page_slug: "test/t", date: "2026-01-01", source: "src.pdf", summary: "Event one" },
        { id: 2, page_slug: "test/t", date: "2026-02-01", source: "", summary: "Event two" },
      ]
    );
    expect(md).toContain("## Timeline");
    expect(md).toContain("**2026-01-01** | src.pdf — Event one");
    expect(md).toContain("**2026-02-01** — Event two");
  });

  test("markdownToPage parses frontmatter", () => {
    const md = `---
slug: concepts/ai
title: Artificial Intelligence
tags: [ai, tech]
created: '2026-04-08'
updated: '2026-04-08'
---
AI is transforming the world.
`;
    const result = markdownToPage(md);
    expect(result.input.slug).toBe("concepts/ai");
    expect(result.input.title).toBe("Artificial Intelligence");
    expect(result.input.tags).toEqual(["ai", "tech"]);
    expect(result.input.compiled_truth).toBe("AI is transforming the world.");
  });

  test("markdownToPage parses timeline", () => {
    const md = `---
slug: test/t
title: T
tags: []
---
Body content.

---

## Timeline

- **2026-04-01** | report.pdf — First event
- **2026-03-15** — Second event no source
`;
    const result = markdownToPage(md);
    expect(result.input.compiled_truth).toBe("Body content.");
    expect(result.timelineEntries.length).toBe(2);
    expect(result.timelineEntries[0].date).toBe("2026-04-01");
    expect(result.timelineEntries[0].source).toBe("report.pdf");
    expect(result.timelineEntries[0].summary).toBe("First event");
    expect(result.timelineEntries[1].source).toBe("");
  });

  test("roundtrip: page → markdown → page", () => {
    const original = {
      slug: "test/round",
      title: "Roundtrip Test",
      compiled_truth: "This is the compiled truth.\n\nWith multiple paragraphs.",
      timeline: "",
      created_at: "2026-04-08 10:00:00",
      updated_at: "2026-04-08 11:00:00",
    };
    const tags = ["test", "roundtrip"];
    const timeline = [
      { id: 1, page_slug: "test/round", date: "2026-04-08", source: "test.md", summary: "Created page" },
    ];

    const md = pageToMarkdown(original, tags, timeline);
    const parsed = markdownToPage(md);

    expect(parsed.input.slug).toBe("test/round");
    expect(parsed.input.title).toBe("Roundtrip Test");
    expect(parsed.input.tags!.sort()).toEqual(["roundtrip", "test"]); // order may vary
    expect(parsed.input.compiled_truth).toContain("This is the compiled truth.");
    expect(parsed.input.compiled_truth).toContain("With multiple paragraphs.");
    expect(parsed.timelineEntries.length).toBe(1);
    expect(parsed.timelineEntries[0].source).toBe("test.md");
  });

  test("extractWikiLinks basic", () => {
    expect(extractWikiLinks("See [[page-a]] and [[page-b|Label]]").sort())
      .toEqual(["page-a", "page-b"]);
  });

  test("extractWikiLinks deduplicates", () => {
    expect(extractWikiLinks("[[a]] foo [[a]]")).toEqual(["a"]);
  });

  test("extractWikiLinks normalizes", () => {
    expect(extractWikiLinks("[[My Page]]")).toEqual(["my-page"]);
  });

  test("extractWikiLinks empty content", () => {
    expect(extractWikiLinks("no links")).toEqual([]);
  });
});

// ==================== Sync ====================
describe("sync", () => {
  test("syncPageToFile creates markdown file", () => {
    putPage({ slug: "people/test", title: "Test", compiled_truth: "Content here.", tags: ["person"] });
    const result = syncPageToFile("people/test");
    expect(result).toBe(true);
    const filePath = join(wikiDir, "people/test.md");
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("slug: people/test");
    expect(content).toContain("Content here.");
  });

  test("syncPageToFile returns false for nonexistent", () => {
    expect(syncPageToFile("nonexistent")).toBe(false);
  });

  test("syncPageToFile creates nested directories", () => {
    putPage({ slug: "deep/nested/page", title: "Deep", compiled_truth: "Deep content" });
    syncPageToFile("deep/nested/page");
    expect(existsSync(join(wikiDir, "deep/nested/page.md"))).toBe(true);
  });

  test("syncFileToDbAsync imports markdown file", async () => {
    // Write a markdown file directly
    const filePath = join(wikiDir, "concepts/imported.md");
    const { mkdirSync, writeFileSync } = await import("fs");
    mkdirSync(join(wikiDir, "concepts"), { recursive: true });
    writeFileSync(filePath, `---
slug: concepts/imported
title: Imported Page
tags: [import, test]
---
This was imported from a file.
`);
    const slug = await syncFileToDbAsync(filePath);
    expect(slug).toBe("concepts/imported");

    const page = getPage("concepts/imported");
    expect(page).not.toBeNull();
    expect(page!.title).toBe("Imported Page");
    expect(page!.compiled_truth).toBe("This was imported from a file.");
    expect(getTagsForPage("concepts/imported")).toEqual(["import", "test"]);
  });

  test("sync to_wiki exports all pages", async () => {
    putPage({ slug: "test/a", title: "A", compiled_truth: "A content" });
    putPage({ slug: "test/b", title: "B", compiled_truth: "B content" });
    const result = await sync("to_wiki");
    expect(result.exported.length).toBe(2);
    expect(existsSync(join(wikiDir, "test/a.md"))).toBe(true);
    expect(existsSync(join(wikiDir, "test/b.md"))).toBe(true);
  });

  test("sync from_wiki imports files", async () => {
    const { mkdirSync, writeFileSync } = await import("fs");
    mkdirSync(join(wikiDir, "test"), { recursive: true });
    writeFileSync(join(wikiDir, "test/fromfile.md"), `---
slug: test/fromfile
title: From File
tags: []
---
File content.
`);
    const result = await sync("from_wiki");
    expect(result.imported).toContain("test/fromfile");
    expect(getPage("test/fromfile")!.compiled_truth).toBe("File content.");
  });

  test("exportAll generates index.md", async () => {
    putPage({ slug: "people/alice", title: "Alice", compiled_truth: "" });
    putPage({ slug: "concepts/ai", title: "AI", compiled_truth: "" });
    await exportAll();
    const indexPath = join(wikiDir, "index.md");
    expect(existsSync(indexPath)).toBe(true);
    const indexContent = readFileSync(indexPath, "utf-8");
    expect(indexContent).toContain("[[people/alice|Alice]]");
    expect(indexContent).toContain("[[concepts/ai|AI]]");
    expect(indexContent).toContain("2 pages total");
  });

  test("sync roundtrip: DB → file → DB", async () => {
    putPage({ slug: "test/rt", title: "Roundtrip", compiled_truth: "Original content", tags: ["rt"] });
    addTimelineEntry({ page_slug: "test/rt", date: "2026-01-01", source: "src", summary: "Entry" });

    // Export to file
    syncPageToFile("test/rt");

    // Delete from DB
    const db = getDb();
    db.run("DELETE FROM timeline_entries WHERE page_slug = ?", ["test/rt"]);
    deletePage("test/rt");
    expect(getPage("test/rt")).toBeNull();

    // Re-import from file
    const slug = await syncFileToDbAsync(join(wikiDir, "test/rt.md"));
    expect(slug).toBe("test/rt");
    expect(getPage("test/rt")!.compiled_truth).toBe("Original content");
    expect(getTagsForPage("test/rt")).toContain("rt");
    expect(getTimeline("test/rt").length).toBe(1);
  });
});

// ==================== Hybrid Search ====================
describe("hybrid search", () => {
  test("hybridSearch without vector provider (FTS only)", async () => {
    putPage({ slug: "test/nvidia", title: "NVIDIA", compiled_truth: "GPU maker CUDA parallel computing" });
    putPage({ slug: "test/amd", title: "AMD", compiled_truth: "CPU and GPU maker ROCm" });

    const results = await hybridSearch({ query: "CUDA GPU" }, null);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].slug).toBe("test/nvidia");
  });

  test("hybridSearch respects limit", async () => {
    for (let i = 0; i < 10; i++) {
      putPage({ slug: `test/p${i}`, title: `P${i}`, compiled_truth: "shared keyword content" });
    }
    const results = await hybridSearch({ query: "shared keyword", limit: 3 }, null);
    expect(results.length).toBe(3);
  });

  test("hybridSearch empty query returns empty", async () => {
    putPage({ slug: "test/a", title: "A", compiled_truth: "content" });
    const results = await hybridSearch({ query: "" }, null);
    expect(results.length).toBe(0);
  });
});

// ==================== CLI Integration ====================
describe("cli integration (via bun run)", () => {
  const projectRoot = join(import.meta.dir, "../..");

  const cliRun = async (args: string): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
    const proc = Bun.spawn(
      ["bun", "run", "src/cli/index.ts", ...args.split(/\s+/)],
      { cwd: projectRoot, env: { ...process.env }, stdout: "pipe", stderr: "pipe" }
    );
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    return { stdout, stderr, exitCode };
  };

  test("--help shows usage", async () => {
    const { stdout, exitCode } = await cliRun("--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("gbrain");
    expect(stdout).toContain("Usage:");
  });

  test("stats on fresh db", async () => {
    const { stdout, exitCode } = await cliRun("stats");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Pages:");
  });

  test("list shows output", async () => {
    const { stdout, exitCode } = await cliRun("list");
    expect(exitCode).toBe(0);
    // May have pages from previous tests or show "No pages"
    expect(stdout.length).toBeGreaterThan(0);
  });

  test("get nonexistent page fails", async () => {
    const { exitCode } = await cliRun("get nonexistent/page");
    expect(exitCode).not.toBe(0);
  });

  test("tags shows output", async () => {
    const { stdout, exitCode } = await cliRun("tags");
    expect(exitCode).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);
  });
});
