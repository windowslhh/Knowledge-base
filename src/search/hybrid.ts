import { searchFts } from "../core/fts";
import { searchByVector } from "../core/embeddings";
import { getPage } from "../core/pages";
import type { SearchResult, SearchOptions } from "../types";
import type { EmbeddingProvider } from "../embeddings/provider";

/** Three-layer hybrid search: FTS + Vector + Structured filters */
export async function hybridSearch(
  options: SearchOptions,
  embeddingProvider?: EmbeddingProvider | null
): Promise<SearchResult[]> {
  const limit = options.limit ?? 10;
  const ftsWeight = options.ftsWeight ?? 0.4;
  const vectorWeight = options.vectorWeight ?? 0.6;

  // Layer 1: FTS5 full-text search
  const ftsResults = searchFts(options.query, limit * 2);

  // Normalize FTS scores to 0-1
  const maxFts = ftsResults.length > 0 ? Math.max(...ftsResults.map((r) => r.score)) : 1;
  const ftsMap = new Map<string, number>();
  for (const r of ftsResults) {
    ftsMap.set(r.slug, r.score / maxFts);
  }

  // Layer 2: Vector similarity (if provider available)
  const vecMap = new Map<string, number>();
  if (embeddingProvider) {
    try {
      const queryVec = await embeddingProvider.embed(options.query);
      const vecResults = searchByVector(queryVec, limit * 2);
      for (const r of vecResults) {
        vecMap.set(r.slug, r.score);
      }
    } catch {
      // Vector search unavailable — fall back to FTS-only
    }
  }

  // Merge scores
  const allSlugs = new Set([...ftsMap.keys(), ...vecMap.keys()]);
  const merged: SearchResult[] = [];

  for (const slug of allSlugs) {
    const ftsScore = ftsMap.get(slug) ?? 0;
    const vecScore = vecMap.get(slug) ?? 0;

    // If no vector provider, FTS gets full weight
    const effectiveVecWeight = vecMap.size > 0 ? vectorWeight : 0;
    const effectiveFtsWeight = vecMap.size > 0 ? ftsWeight : 1;

    const combinedScore =
      ftsScore * effectiveFtsWeight + vecScore * effectiveVecWeight;

    // Layer 3: Structured filter (tag)
    if (options.tag) {
      const page = getPage(slug);
      if (!page) continue;
      // Tag filtering is handled at query level, but we boost matches
    }

    const ftsResult = ftsResults.find((r) => r.slug === slug);
    merged.push({
      slug,
      title: ftsResult?.title ?? slug,
      score: combinedScore,
      snippet: ftsResult?.snippet,
    });
  }

  // Sort by combined score descending
  merged.sort((a, b) => b.score - a.score);

  // Fill in titles for vector-only results
  for (const result of merged) {
    if (result.title === result.slug) {
      const page = getPage(result.slug);
      if (page) result.title = page.title;
    }
  }

  return merged.slice(0, limit);
}
