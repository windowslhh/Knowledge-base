import { getDb } from "./db";
import type { EmbeddingChunk } from "../types";

export function storeEmbedding(
  pageSlug: string,
  chunkIndex: number,
  vector: Float32Array
): void {
  const db = getDb();
  const blob = Buffer.from(vector.buffer);
  db.run(
    `INSERT OR REPLACE INTO embeddings (page_slug, chunk_index, vector)
     VALUES (?, ?, ?)`,
    [pageSlug, chunkIndex, blob]
  );
}

export function getEmbeddings(pageSlug: string): EmbeddingChunk[] {
  const db = getDb();
  const rows = db
    .query(
      "SELECT * FROM embeddings WHERE page_slug = ? ORDER BY chunk_index"
    )
    .all(pageSlug) as { page_slug: string; chunk_index: number; vector: Buffer }[];

  return rows.map((r) => ({
    page_slug: r.page_slug,
    chunk_index: r.chunk_index,
    vector: new Float32Array(
      r.vector.buffer,
      r.vector.byteOffset,
      r.vector.byteLength / 4
    ),
  }));
}

export function deleteEmbeddings(pageSlug: string): void {
  const db = getDb();
  db.run("DELETE FROM embeddings WHERE page_slug = ?", [pageSlug]);
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** Search all embeddings by cosine similarity to a query vector */
export function searchByVector(
  queryVector: Float32Array,
  limit: number = 10
): { slug: string; score: number }[] {
  const db = getDb();
  const rows = db
    .query("SELECT DISTINCT page_slug FROM embeddings")
    .all() as { page_slug: string }[];

  const scores: { slug: string; score: number }[] = [];

  for (const row of rows) {
    const chunks = getEmbeddings(row.page_slug);
    let maxScore = 0;
    for (const chunk of chunks) {
      const sim = cosineSimilarity(queryVector, chunk.vector);
      if (sim > maxScore) maxScore = sim;
    }
    scores.push({ slug: row.page_slug, score: maxScore });
  }

  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, limit);
}
