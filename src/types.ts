/** Core page entity — the fundamental unit of the knowledge base */
export interface Page {
  slug: string;
  title: string;
  compiled_truth: string;
  timeline: string;
  created_at: string;
  updated_at: string;
}

/** Input for creating/updating a page */
export interface PageInput {
  slug: string;
  title: string;
  compiled_truth: string;
  timeline?: string;
  tags?: string[];
}

/** A timeline entry attached to a page */
export interface TimelineEntry {
  id?: number;
  page_slug: string;
  date: string;
  source: string;
  summary: string;
}

/** A link between two pages */
export interface Link {
  source_slug: string;
  target_slug: string;
}

/** An ingestion log record */
export interface IngestLogEntry {
  id?: number;
  source_path: string;
  timestamp: string;
  pages_touched: string[];
}

/** Raw data associated with a page */
export interface RawData {
  id?: number;
  page_slug: string;
  source: string;
  data: string;
}

/** Embedding chunk for a page */
export interface EmbeddingChunk {
  page_slug: string;
  chunk_index: number;
  vector: Float32Array;
}

/** Search result from any search method */
export interface SearchResult {
  slug: string;
  title: string;
  score: number;
  snippet?: string;
}

/** Hybrid search options */
export interface SearchOptions {
  query: string;
  limit?: number;
  tag?: string;
  ftsWeight?: number;
  vectorWeight?: number;
}

/** Configuration key-value pair */
export interface ConfigEntry {
  key: string;
  value: string;
}

/** Page with resolved metadata for display/export */
export interface PageWithMeta extends Page {
  tags: string[];
  timeline_entries: TimelineEntry[];
  backlinks: string[];
}

/** Sync direction for wiki/ ↔ SQLite */
export type SyncDirection = "both" | "to_wiki" | "from_wiki";

/** Sync result summary */
export interface SyncResult {
  exported: string[];
  imported: string[];
  conflicts: string[];
}
