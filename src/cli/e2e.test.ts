#!/usr/bin/env bun
/**
 * GBrain End-to-End Integration Test
 * Runs all real-world scenarios in sequence, fails fast on any error.
 */
import { openDb, closeDb, getDb, getConfig, setConfig } from "../core/db";
import { getPage, putPage, deletePage, listPages, countPages } from "../core/pages";
import { getTagsForPage, setTagsForPage, addTag, removeTag, listAllTags, getPagesByTag } from "../core/tags";
import { addTimelineEntry, getTimeline, getRecentTimeline } from "../core/timeline";
import { logIngest, getIngestLog, storeRawData, getRawData } from "../core/ingest-log";
import { searchFts, rebuildFtsIndex } from "../core/fts";
import { addLink, getLinks, getBacklinks, updateLinksFromContent } from "../core/links";
import { storeEmbedding, getEmbeddings, deleteEmbeddings, cosineSimilarity, searchByVector } from "../core/embeddings";
import { pageToMarkdown, markdownToPage, extractWikiLinks } from "../core/markdown";
import { syncPageToFile, syncFileToDbAsync, sync, exportAll, setWikiDir, getWikiDir } from "../core/sync";
import { hybridSearch } from "../search/hybrid";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let tmpDir: string;
let wikiDir: string;
let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`  ✗ FAIL: ${msg}`);
    failed++;
  } else {
    passed++;
  }
}

function section(name: string) {
  console.log(`\n▸ ${name}`);
}

// ============================================================
// Setup
// ============================================================
tmpDir = mkdtempSync(join(tmpdir(), "gbrain-e2e-"));
const dbPath = join(tmpDir, "test.db");
wikiDir = join(tmpDir, "wiki");
mkdirSync(wikiDir, { recursive: true });
openDb(dbPath);
setWikiDir(wikiDir);

try {

// ============================================================
// 1. INGEST WORKFLOW: source doc → multiple pages → timeline → raw data → links
// ============================================================
section("1. Ingest workflow");

putPage({
  slug: "companies/nvidia",
  title: "NVIDIA",
  compiled_truth: "全球领先的 GPU 和 AI 芯片公司。\n\n- CEO: [[people/jensen-huang|黄仁勋]]\n- 产品: [[products/b200]]、H100\n- 竞争对手: [[companies/amd]]",
  tags: ["公司", "GPU", "AI"],
});
putPage({
  slug: "people/jensen-huang",
  title: "Jensen Huang 黄仁勋",
  compiled_truth: "[[companies/nvidia]] 创始人兼 CEO。推动 GPU 从图形转向 AI 计算。",
  tags: ["人物", "CEO"],
});
putPage({
  slug: "products/b200",
  title: "Blackwell B200",
  compiled_truth: "[[companies/nvidia]] 下一代 AI GPU。[[companies/tsmc]] 3nm 工艺。",
  tags: ["产品", "GPU"],
});
putPage({
  slug: "companies/amd",
  title: "AMD",
  compiled_truth: "[[companies/nvidia]] 的主要竞争对手。MI300X 对标 H100。",
  tags: ["公司", "GPU"],
});
putPage({
  slug: "companies/tsmc",
  title: "TSMC 台积电",
  compiled_truth: "芯片代工。为 [[companies/nvidia]] 制造 [[products/b200]]。",
  tags: ["公司", "半导体"],
});
putPage({
  slug: "concepts/cuda",
  title: "CUDA",
  compiled_truth: "[[companies/nvidia]] 并行计算平台。500 万开发者。PyTorch 底层依赖。",
  tags: ["技术", "GPU"],
});

assert(countPages() === 6, "6 pages created");

// Timeline
addTimelineEntry({ page_slug: "companies/nvidia", date: "2026-04-08", source: "q1-earnings.pdf", summary: "Q1 收入 $44.1B" });
addTimelineEntry({ page_slug: "companies/nvidia", date: "2026-05-28", source: "q2-earnings.pdf", summary: "Q2 收入 $46.8B" });
assert(getTimeline("companies/nvidia").length === 2, "2 timeline entries");
assert(getTimeline("companies/nvidia")[0].date === "2026-05-28", "Timeline DESC order");

// Raw data & ingest log
storeRawData("companies/nvidia", "q1-earnings.pdf", "raw q1 content...");
logIngest("q1-earnings.pdf", ["companies/nvidia", "people/jensen-huang"]);
assert(getRawData("companies/nvidia").length === 1, "Raw data stored");
assert(getIngestLog()[0].pages_touched.length === 2, "Ingest log tracks pages");

// Auto-extracted links
const nvidiaLinks = getLinks("companies/nvidia").sort();
assert(nvidiaLinks.includes("companies/amd"), "NVIDIA→AMD link auto-extracted");
assert(nvidiaLinks.includes("people/jensen-huang"), "NVIDIA→Jensen link auto-extracted");
assert(nvidiaLinks.includes("products/b200"), "NVIDIA→B200 link auto-extracted");

// Backlinks
const jensenBL = getBacklinks("people/jensen-huang");
assert(jensenBL.includes("companies/nvidia"), "Backlink from NVIDIA to Jensen");

// Wiki file sync
for (const slug of ["companies/nvidia", "people/jensen-huang", "products/b200"]) {
  syncPageToFile(slug);
}
assert(existsSync(join(wikiDir, "companies/nvidia.md")), "Wiki file created for nvidia");
assert(existsSync(join(wikiDir, "people/jensen-huang.md")), "Wiki file created for jensen");

// Verify wiki file content is Obsidian-compatible
const nvMd = readFileSync(join(wikiDir, "companies/nvidia.md"), "utf-8");
assert(nvMd.includes("slug: companies/nvidia"), "Wiki file has frontmatter slug");
assert(nvMd.includes("[[people/jensen-huang|黄仁勋]]"), "Wiki file preserves wiki-links");
assert(nvMd.includes("## Timeline"), "Wiki file has timeline section");
assert(nvMd.includes("***"), "Timeline separator is *** not ---");

console.log("  ✓ Ingest workflow complete");

// ============================================================
// 2. QUERY WORKFLOW: search → read → synthesize
// ============================================================
section("2. Query workflow");

// Chinese search
const r1 = searchFts("创始人");
assert(r1.length > 0, "Chinese search '创始人' finds results");

// English search
const r2 = searchFts("GPU");
assert(r2.length >= 2, "English search 'GPU' finds multiple results");

// Short term (2 chars, needs unicode61 index)
const r3 = searchFts("AI");
assert(r3.length >= 1, "Short term 'AI' finds results via unicode61");

// CJK substring (needs trigram index)
const r4 = searchFts("并行计算");
assert(r4.length >= 1, "CJK substring '并行计算' finds results via trigram");

// Hybrid search
const h1 = await hybridSearch({ query: "NVIDIA 竞争对手", limit: 5 }, null);
assert(h1.length > 0, "Hybrid search finds results");

// Hybrid search with tag filter
const h2 = await hybridSearch({ query: "GPU", tag: "公司", limit: 10 }, null);
assert(h2.length > 0, "Hybrid search with tag filter finds results");
assert(h2.every(r => getTagsForPage(r.slug).includes("公司")), "Tag filter only returns pages with tag");

// No results
const r5 = searchFts("量子计算区块链");
assert(r5.length === 0, "Nonexistent term returns empty");

// Score sanity: top result has score 1.0
assert(r1[0].score === 1.0, "Top FTS result has normalized score 1.0");

console.log("  ✓ Query workflow complete");

// ============================================================
// 3. INCREMENTAL UPDATE: new source merges without losing old data
// ============================================================
section("3. Incremental update");

const beforeUpdate = getPage("companies/nvidia")!;
const beforeCreated = beforeUpdate.created_at;

putPage({
  slug: "companies/nvidia",
  title: "NVIDIA",
  compiled_truth: "全球领先的 GPU 和 AI 芯片公司。FY2026 Q2 收入 $46.8B。\n\n- CEO: [[people/jensen-huang|黄仁勋]]\n- 产品: [[products/b200]]（已量产）、H100\n- 竞争: [[companies/amd]]（MI300X）\n\n[历史] Q1 收入 $44.1B",
  tags: ["公司", "GPU", "AI"],
});

const afterUpdate = getPage("companies/nvidia")!;
assert(afterUpdate.created_at === beforeCreated, "created_at preserved after update");
assert(afterUpdate.compiled_truth.includes("$46.8B"), "New data merged in");
assert(afterUpdate.compiled_truth.includes("[历史] Q1"), "Old data preserved as historical");
assert(getTimeline("companies/nvidia").length === 2, "Timeline entries survive update");

// FTS index updated
const r6 = searchFts("46.8B");
assert(r6.length >= 1, "FTS updated with new content");
const r7 = searchFts("44.1B");
assert(r7.length >= 1, "FTS still finds old content");

console.log("  ✓ Incremental update complete");

// ============================================================
// 4. ENRICH WORKFLOW: cross-reference, backlinks, tags
// ============================================================
section("4. Enrich workflow");

// Update AMD page with richer cross-references
putPage({
  slug: "companies/amd",
  title: "AMD",
  compiled_truth: "[[companies/nvidia]] 竞争对手。\n- MI300X 对标 H100\n- ROCm 对标 [[concepts/cuda]]\n- 制造: [[companies/tsmc]]",
  tags: ["公司", "GPU", "AI芯片"],
});

// Verify new backlinks appeared
const cudaBL = getBacklinks("concepts/cuda");
assert(cudaBL.includes("companies/amd"), "AMD→CUDA backlink after enrich");
const tsmcBL = getBacklinks("companies/tsmc");
assert(tsmcBL.includes("companies/amd"), "AMD→TSMC backlink after enrich");

// Verify old links replaced
const amdLinks = getLinks("companies/amd").sort();
assert(amdLinks.includes("companies/nvidia"), "AMD still links to NVIDIA");
assert(amdLinks.includes("concepts/cuda"), "AMD now links to CUDA");
assert(amdLinks.includes("companies/tsmc"), "AMD now links to TSMC");

console.log("  ✓ Enrich workflow complete");

// ============================================================
// 5. OBSIDIAN SYNC: bidirectional with timeline
// ============================================================
section("5. Obsidian sync");

// 5a. Export all → verify index.md
await exportAll();
assert(existsSync(join(wikiDir, "index.md")), "index.md generated");
const indexContent = readFileSync(join(wikiDir, "index.md"), "utf-8");
assert(indexContent.includes("[[companies/nvidia|NVIDIA]]"), "index.md has NVIDIA entry");

// 5b. Simulate human editing in Obsidian: modify a file
const nvPath = join(wikiDir, "companies/nvidia.md");
let nvContent = readFileSync(nvPath, "utf-8");
nvContent = nvContent.replace("全球领先的", "【人工编辑】全球领先的");
writeFileSync(nvPath, nvContent);

// 5c. Simulate human creating new file in Obsidian
mkdirSync(join(wikiDir, "people"), { recursive: true });
writeFileSync(join(wikiDir, "people/sam-altman.md"), `---
slug: people/sam-altman
title: Sam Altman
tags: [人物, OpenAI]
---
OpenAI CEO。与 [[people/jensen-huang|黄仁勋]] 同为 AI 领袖。

***

## Timeline

- **2022-11-30** | openai — ChatGPT 发布
`);

// 5d. Sync from wiki
const syncResult = await sync("from_wiki");
assert(syncResult.imported.length > 0, "Sync imported files");

// 5e. Verify human edit reflected in DB
const nvAfterSync = getPage("companies/nvidia")!;
assert(nvAfterSync.compiled_truth.includes("【人工编辑】"), "Human edit synced to DB");

// 5f. Verify new Obsidian file imported
const sam = getPage("people/sam-altman");
assert(sam !== null, "Obsidian-created page imported");
assert(sam!.title === "Sam Altman", "Title parsed from frontmatter");
assert(getTagsForPage("people/sam-altman").includes("OpenAI"), "Tags parsed");
const samTimeline = getTimeline("people/sam-altman");
assert(samTimeline.length === 1, "Timeline parsed from Obsidian file");
assert(samTimeline[0].summary === "ChatGPT 发布", "Timeline content correct");

// 5g. Verify wiki-links from Obsidian file extracted
const samLinks = getLinks("people/sam-altman");
assert(samLinks.includes("people/jensen-huang"), "Wiki-link from Obsidian file extracted");

// 5h. Sync roundtrip: timeline survives export→reimport
syncPageToFile("companies/nvidia");
const nvExported = readFileSync(nvPath, "utf-8");
assert(nvExported.includes("## Timeline"), "Exported file has timeline");
assert(nvExported.includes("Q1 收入"), "Timeline entry content preserved");

console.log("  ✓ Obsidian sync complete");

// ============================================================
// 6. MAINTAIN WORKFLOW: health checks
// ============================================================
section("6. Maintain workflow");

// 6a. Orphan detection (pages with no inbound links)
const allPages = listPages({ limit: 1000 });
const orphans = allPages.filter(p => getBacklinks(p.slug).length === 0);
// Sam Altman was just created and no one links to it yet (except from Obsidian sync)
// concepts/cuda might not have backlinks from everyone

// 6b. Missing tags
const noTags = allPages.filter(p => getTagsForPage(p.slug).length === 0);
assert(noTags.length === 0, "All pages have tags");

// 6c. Broken links (target doesn't exist)
const db = getDb();
const allLinks = db.query("SELECT * FROM links").all() as { source_slug: string; target_slug: string }[];
const brokenLinks = allLinks.filter(l => !getPage(l.target_slug));
// Some broken links expected (e.g., companies/tsmc→products/b200 if tsmc was synced from wiki)
// Just ensure it doesn't crash
assert(typeof brokenLinks.length === "number", "Broken link check runs without error");

// 6d. Tag consistency
const allTags = listAllTags();
assert(allTags.length > 0, "Tags exist");

// 6e. Pages without timeline
const noTimeline = allPages.filter(p => getTimeline(p.slug).length === 0);
assert(typeof noTimeline.length === "number", "Timeline check runs without error");

console.log("  ✓ Maintain workflow complete");

// ============================================================
// 7. DELETE CASCADE
// ============================================================
section("7. Delete cascade");

putPage({ slug: "test/del-cascade", title: "Del", compiled_truth: "[[companies/nvidia]] link", tags: ["del"] });
addTimelineEntry({ page_slug: "test/del-cascade", date: "2026-01-01", source: "", summary: "Entry" });
storeRawData("test/del-cascade", "src", "data");
storeEmbedding("test/del-cascade", 0, new Float32Array([0.1, 0.2, 0.3]));
syncPageToFile("test/del-cascade");
assert(existsSync(join(wikiDir, "test/del-cascade.md")), "Wiki file exists before delete");

deletePage("test/del-cascade");

assert(getPage("test/del-cascade") === null, "Page deleted");
assert(getTagsForPage("test/del-cascade").length === 0, "Tags cascade deleted");
assert(getTimeline("test/del-cascade").length === 0, "Timeline cascade deleted");
assert(getRawData("test/del-cascade").length === 0, "Raw data cascade deleted");
assert(getEmbeddings("test/del-cascade").length === 0, "Embeddings cascade deleted");
assert(getLinks("test/del-cascade").length === 0, "Links (source) cascade deleted");
assert(searchFts("del-cascade").length === 0, "FTS cleaned up");
assert(!existsSync(join(wikiDir, "test/del-cascade.md")), "Wiki file deleted");

console.log("  ✓ Delete cascade complete");

// ============================================================
// 8. EDGE CASES
// ============================================================
section("8. Edge cases");

// 8a. Large content
const longContent = "这是一段重复内容。".repeat(1000);
putPage({ slug: "test/large", title: "Large", compiled_truth: longContent, tags: ["test"] });
assert(getPage("test/large")!.compiled_truth.length === longContent.length, "Large content preserved");
assert(searchFts("重复内容").length >= 1, "Large content searchable");

// 8b. Special characters
putPage({
  slug: "test/special",
  title: 'Special "Chars" & <Tags>',
  compiled_truth: 'Content with "quotes" and <html> and [brackets] and 日本語 and E=mc²',
  tags: ["special"],
});
assert(getPage("test/special")!.title.includes('"Chars"'), "Special chars in title preserved");
assert(searchFts("日本語").length >= 1, "Japanese searchable");

// 8c. Deep nested slug
putPage({ slug: "a/b/c/d/deep", title: "Deep", compiled_truth: "deep content", tags: ["test"] });
syncPageToFile("a/b/c/d/deep");
assert(existsSync(join(wikiDir, "a/b/c/d/deep.md")), "Deep nested wiki file created");

// 8d. Empty content
putPage({ slug: "test/empty", title: "Empty", compiled_truth: "", tags: ["test"] });
assert(getPage("test/empty")!.compiled_truth === "", "Empty content stored");

// 8e. Backlink cycle
putPage({ slug: "test/a", title: "A", compiled_truth: "Link to [[test/b]]", tags: [] });
putPage({ slug: "test/b", title: "B", compiled_truth: "Link to [[test/a]]", tags: [] });
assert(getBacklinks("test/a").includes("test/b"), "Cycle: B→A backlink");
assert(getBacklinks("test/b").includes("test/a"), "Cycle: A→B backlink");

// 8f. Config persistence
setConfig("e2e_test", "hello_world");
closeDb();
openDb(dbPath);
assert(getConfig("e2e_test") === "hello_world", "Config persists across reopen");

// 8g. Embedding + vector search
putPage({ slug: "test/vec", title: "Vector", compiled_truth: "vector test", tags: [] });
storeEmbedding("test/vec", 0, new Float32Array([1, 0, 0]));
storeEmbedding("test/vec", 1, new Float32Array([0, 1, 0]));
const vecResults = searchByVector(new Float32Array([1, 0, 0]), 5);
assert(vecResults.length >= 1, "Vector search returns results");
assert(vecResults[0].slug === "test/vec", "Vector search finds correct page");

// 8h. Cosine similarity edge cases
assert(Math.abs(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([1, 0])) - 1.0) < 0.001, "Identical vectors = 1.0");
assert(Math.abs(cosineSimilarity(new Float32Array([1, 0]), new Float32Array([0, 1]))) < 0.001, "Orthogonal = 0.0");
assert(cosineSimilarity(new Float32Array([1, 2]), new Float32Array([1, 2, 3])) === 0, "Different lengths = 0");

console.log("  ✓ Edge cases complete");

// ============================================================
// 9. MULTI-SOURCE CONFLICT
// ============================================================
section("9. Multi-source conflict");

putPage({
  slug: "test/conflict",
  title: "Conflict Test",
  compiled_truth: "数据一：来源 A 说 100%\n数据二：来源 B 说 80%\n**注意**: 数据口径不同",
  tags: ["test"],
});
addTimelineEntry({ page_slug: "test/conflict", date: "2026-01-01", source: "source-a.pdf", summary: "来源 A: 100%" });
addTimelineEntry({ page_slug: "test/conflict", date: "2026-01-15", source: "source-b.pdf", summary: "来源 B: 80%" });

const conflictPage = getPage("test/conflict")!;
assert(conflictPage.compiled_truth.includes("数据口径不同"), "Conflict noted in compiled truth");
const conflictTimeline = getTimeline("test/conflict");
assert(conflictTimeline.length === 2, "Both sources recorded in timeline");

console.log("  ✓ Multi-source conflict complete");

// ============================================================
// 10. BRIEFING GENERATION
// ============================================================
section("10. Briefing generation");

putPage({
  slug: "briefings/test-brief",
  title: "测试简报",
  compiled_truth: "## 概要\n[[companies/nvidia]] 主导 AI 芯片市场。\n\n## 关键玩家\n- [[companies/nvidia]]\n- [[companies/amd]]\n\n## 数据来源\n- Q1/Q2 财报",
  tags: ["简报"],
});

assert(getPage("briefings/test-brief") !== null, "Briefing page created");
assert(getLinks("briefings/test-brief").includes("companies/nvidia"), "Briefing links to nvidia");
assert(searchFts("测试简报").length >= 1, "Briefing searchable");

console.log("  ✓ Briefing generation complete");

// ============================================================
// RESULTS
// ============================================================
console.log(`\n${"=".repeat(50)}`);
console.log(`E2E Results: ${passed} passed, ${failed} failed`);
console.log(`${"=".repeat(50)}`);

if (failed > 0) {
  process.exit(1);
}

} finally {
  closeDb();
  setWikiDir(null as any);
  rmSync(tmpDir, { recursive: true, force: true });
}
