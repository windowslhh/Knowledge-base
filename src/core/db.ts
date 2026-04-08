import { Database } from "bun:sqlite";
import { join } from "path";

let _db: Database | null = null;
let _dbPath: string | null = null;

const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS pages (
    slug TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    compiled_truth TEXT NOT NULL DEFAULT '',
    timeline TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE VIRTUAL TABLE IF NOT EXISTS page_fts USING fts5(
    slug UNINDEXED, title, content,
    tokenize='porter ascii'
);

CREATE TABLE IF NOT EXISTS embeddings (
    page_slug TEXT NOT NULL,
    chunk_index INTEGER NOT NULL DEFAULT 0,
    vector BLOB NOT NULL,
    PRIMARY KEY (page_slug, chunk_index),
    FOREIGN KEY (page_slug) REFERENCES pages(slug) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS links (
    source_slug TEXT NOT NULL,
    target_slug TEXT NOT NULL,
    PRIMARY KEY (source_slug, target_slug),
    FOREIGN KEY (source_slug) REFERENCES pages(slug) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_slug);

CREATE TABLE IF NOT EXISTS tags (
    page_slug TEXT NOT NULL,
    tag TEXT NOT NULL,
    PRIMARY KEY (page_slug, tag),
    FOREIGN KEY (page_slug) REFERENCES pages(slug) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);

CREATE TABLE IF NOT EXISTS raw_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_slug TEXT NOT NULL,
    source TEXT NOT NULL,
    data TEXT NOT NULL,
    FOREIGN KEY (page_slug) REFERENCES pages(slug) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS timeline_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_slug TEXT NOT NULL,
    date TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL,
    FOREIGN KEY (page_slug) REFERENCES pages(slug) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_timeline_slug ON timeline_entries(page_slug);
CREATE INDEX IF NOT EXISTS idx_timeline_date ON timeline_entries(date DESC);

CREATE TABLE IF NOT EXISTS ingest_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_path TEXT NOT NULL,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    pages_touched TEXT NOT NULL DEFAULT '[]'
);
`;

export function getDbPath(baseDir?: string): string {
  return join(baseDir ?? process.cwd(), "brain.db");
}

export function openDb(path?: string): Database {
  if (_db && _dbPath === (path ?? getDbPath())) return _db;

  const dbPath = path ?? getDbPath();
  const db = new Database(dbPath, { create: true });

  // Run schema
  db.exec(SCHEMA_SQL);

  // Store schema version
  db.run(
    "INSERT OR REPLACE INTO config (key, value) VALUES ('schema_version', ?)",
    [String(SCHEMA_VERSION)]
  );

  _db = db;
  _dbPath = dbPath;
  return db;
}

export function getDb(): Database {
  if (!_db) throw new Error("Database not initialized. Call openDb() first.");
  return _db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
    _dbPath = null;
  }
}

export function getConfig(key: string): string | null {
  const db = getDb();
  const row = db.query("SELECT value FROM config WHERE key = ?").get(key) as
    | { value: string }
    | null;
  return row?.value ?? null;
}

export function setConfig(key: string, value: string): void {
  const db = getDb();
  db.run("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)", [
    key,
    value,
  ]);
}
