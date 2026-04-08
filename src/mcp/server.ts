import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  openDb,
  getPage,
  putPage,
  deletePage,
  listPages,
  searchFts,
  getTagsForPage,
  listAllTags,
  getPagesByTag,
  getBacklinks,
  getTimeline,
  addTimelineEntry,
  storeRawData,
  logIngest,
  syncPageToFile,
  sync,
} from "../core/index";
import { pageToMarkdown } from "../core/markdown";
import { hybridSearch } from "../search/hybrid";
import { createProvider } from "../embeddings/index";
import type { SyncDirection } from "../types";

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "gbrain",
    version: "0.1.0",
  });

  // Ensure DB is open
  openDb();

  // --- search ---
  server.tool(
    "search",
    "Hybrid search across the knowledge base (FTS + vector + structured)",
    {
      query: z.string().describe("Search query"),
      limit: z.number().optional().default(10).describe("Max results"),
    },
    async ({ query, limit }) => {
      const provider = createProvider();
      const results = await hybridSearch({ query, limit }, provider);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    }
  );

  // --- read ---
  server.tool(
    "read",
    "Read a page by slug, returns full Markdown with frontmatter",
    {
      slug: z.string().describe("Page slug (e.g. 'people/jensen-huang')"),
    },
    async ({ slug }) => {
      const page = getPage(slug);
      if (!page) {
        return {
          content: [{ type: "text" as const, text: `Page not found: ${slug}` }],
          isError: true,
        };
      }
      const tags = getTagsForPage(slug);
      const timeline = getTimeline(slug);
      const md = pageToMarkdown(page, tags, timeline);
      return { content: [{ type: "text" as const, text: md }] };
    }
  );

  // --- write ---
  server.tool(
    "write",
    "Create or update a page in the knowledge base",
    {
      slug: z.string().describe("Page slug"),
      title: z.string().describe("Page title"),
      compiled_truth: z.string().describe("Main content (Markdown)"),
      tags: z.array(z.string()).optional().describe("Tags"),
      timeline_entry: z
        .object({
          date: z.string(),
          source: z.string().optional().default(""),
          summary: z.string(),
        })
        .optional()
        .describe("Optional timeline entry to add"),
    },
    async ({ slug, title, compiled_truth, tags, timeline_entry }) => {
      const page = putPage({ slug, title, compiled_truth, tags });

      if (timeline_entry) {
        addTimelineEntry({
          page_slug: slug,
          date: timeline_entry.date,
          source: timeline_entry.source,
          summary: timeline_entry.summary,
        });
      }

      // Auto-sync to wiki/
      syncPageToFile(slug);

      return {
        content: [
          {
            type: "text" as const,
            text: `Saved: ${page.slug} (updated: ${page.updated_at})`,
          },
        ],
      };
    }
  );

  // --- ingest ---
  server.tool(
    "ingest",
    "Store raw data and associate with page(s)",
    {
      source_path: z.string().describe("Source identifier"),
      content: z.string().describe("Raw content to store"),
      page_slug: z.string().describe("Page to associate with"),
    },
    async ({ source_path, content, page_slug }) => {
      storeRawData(page_slug, source_path, content);
      logIngest(source_path, [page_slug]);
      return {
        content: [
          {
            type: "text" as const,
            text: `Ingested: ${source_path} → ${page_slug}`,
          },
        ],
      };
    }
  );

  // --- query ---
  server.tool(
    "query",
    "Answer a question using hybrid search across the knowledge base",
    {
      question: z.string().describe("Question to answer"),
      limit: z.number().optional().default(5).describe("Max results"),
    },
    async ({ question, limit }) => {
      const provider = createProvider();
      const results = await hybridSearch({ query: question, limit }, provider);

      // Return the top results as context
      const pages = results.map((r) => {
        const page = getPage(r.slug);
        return {
          slug: r.slug,
          title: r.title,
          score: r.score,
          content: page?.compiled_truth?.slice(0, 1000) ?? "",
        };
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(pages, null, 2),
          },
        ],
      };
    }
  );

  // --- list ---
  server.tool(
    "list",
    "List pages in the knowledge base",
    {
      tag: z.string().optional().describe("Filter by tag"),
      limit: z.number().optional().default(50),
      offset: z.number().optional().default(0),
    },
    async ({ tag, limit, offset }) => {
      const pages = listPages({ tag, limit, offset });
      const result = pages.map((p) => ({
        slug: p.slug,
        title: p.title,
        updated_at: p.updated_at,
        tags: getTagsForPage(p.slug),
      }));
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
      };
    }
  );

  // --- backlinks ---
  server.tool(
    "backlinks",
    "Find pages that link to the given page",
    {
      slug: z.string().describe("Target page slug"),
    },
    async ({ slug }) => {
      const backlinks = getBacklinks(slug);
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(backlinks) },
        ],
      };
    }
  );

  // --- tags ---
  server.tool(
    "tags",
    "List all tags or get tags for a specific page",
    {
      action: z.enum(["list", "get"]).describe("'list' all tags or 'get' page tags"),
      slug: z.string().optional().describe("Page slug (required for 'get')"),
    },
    async ({ action, slug }) => {
      if (action === "get" && slug) {
        const tags = getTagsForPage(slug);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(tags) }],
        };
      }
      const allTags = listAllTags();
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(allTags, null, 2) },
        ],
      };
    }
  );

  // --- sync ---
  server.tool(
    "sync",
    "Synchronize wiki/ directory with SQLite database",
    {
      direction: z
        .enum(["both", "to_wiki", "from_wiki"])
        .optional()
        .default("both")
        .describe("Sync direction"),
    },
    async ({ direction }) => {
      const result = await sync(direction as SyncDirection);
      return {
        content: [
          {
            type: "text" as const,
            text: `Sync complete: ${result.exported.length} exported, ${result.imported.length} imported`,
          },
        ],
      };
    }
  );

  return server;
}
