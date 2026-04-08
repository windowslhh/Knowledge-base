#!/usr/bin/env bun
import {
  cmdGet,
  cmdPut,
  cmdDelete,
  cmdList,
  cmdSearch,
  cmdQuery,
  cmdLink,
  cmdBacklinks,
  cmdTags,
  cmdTimeline,
  cmdImport,
  cmdExport,
  cmdEmbed,
  cmdSync,
  cmdStats,
  cmdServe,
} from "./commands";

const USAGE = `
gbrain — LLM knowledge base with Obsidian integration

Usage:
  gbrain get <slug>                  Read a page
  gbrain put <slug> [options]        Create/update a page
  gbrain delete <slug>               Delete a page
  gbrain list [--tag TAG] [--limit]  List pages
  gbrain search <query>              FTS5 search
  gbrain query <question> [--limit]  Hybrid search (FTS + vector)
  gbrain link <source> <target>      Create a link
  gbrain backlinks <slug>            Show backlinks
  gbrain tags [slug]                 Show tags
  gbrain timeline <slug>             Show timeline
  gbrain import <path>               Import a Markdown file
  gbrain export [--all]              Export all pages to wiki/
  gbrain embed <slug>                Generate embeddings
  gbrain sync [--direction DIR]      Sync wiki/ ↔ SQLite
  gbrain stats                       Show database stats
  gbrain serve                       Start MCP server

Options for put:
  --title TEXT     Page title
  --file PATH      Read content from file (otherwise stdin)
  --tags TAG,TAG   Comma-separated tags
`.trim();

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    console.log(USAGE);
    process.exit(0);
  }

  // Parse flags
  function getFlag(name: string): string | undefined {
    const idx = args.indexOf(`--${name}`);
    if (idx === -1) return undefined;
    return args[idx + 1];
  }
  function hasFlag(name: string): boolean {
    return args.includes(`--${name}`);
  }

  switch (command) {
    case "get":
      await cmdGet(args[1]);
      break;
    case "put":
      await cmdPut(args[1], {
        title: getFlag("title"),
        file: getFlag("file"),
        tags: getFlag("tags"),
      });
      break;
    case "delete":
      cmdDelete(args[1]);
      break;
    case "list":
      cmdList({ tag: getFlag("tag"), limit: getFlag("limit") });
      break;
    case "search":
      cmdSearch(args.slice(1).join(" "));
      break;
    case "query":
      await cmdQuery(args.slice(1).filter((a) => !a.startsWith("--")).join(" "), {
        limit: getFlag("limit"),
      });
      break;
    case "link":
      cmdLink(args[1], args[2]);
      break;
    case "backlinks":
      cmdBacklinks(args[1]);
      break;
    case "tags":
      cmdTags(args[1]);
      break;
    case "timeline":
      cmdTimeline(args[1]);
      break;
    case "import":
      await cmdImport(args[1]);
      break;
    case "export":
      await cmdExport({ all: hasFlag("all") });
      break;
    case "embed":
      await cmdEmbed(args[1]);
      break;
    case "sync":
      await cmdSync({ direction: getFlag("direction") });
      break;
    case "stats":
      cmdStats();
      break;
    case "serve":
      await cmdServe();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.log(USAGE);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
