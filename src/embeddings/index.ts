import type { EmbeddingProvider } from "./provider";
import { OpenAIEmbeddingProvider } from "./openai";
import { GeminiEmbeddingProvider } from "./gemini";
import { OllamaEmbeddingProvider } from "./ollama";
import { getConfig } from "../core/db";

export type { EmbeddingProvider } from "./provider";
export { OpenAIEmbeddingProvider } from "./openai";
export { GeminiEmbeddingProvider } from "./gemini";
export { OllamaEmbeddingProvider } from "./ollama";

/** Create an embedding provider from stored config or env vars */
export function createProvider(): EmbeddingProvider | null {
  const provider = getConfig("embedding_provider") ?? process.env.EMBEDDING_PROVIDER;
  if (!provider) return null;

  const model = getConfig("embedding_model") ?? process.env.EMBEDDING_MODEL ?? undefined;
  const apiKey = getConfig("embedding_api_key") ?? "";

  switch (provider.toLowerCase()) {
    case "openai": {
      const key = apiKey || process.env.OPENAI_API_KEY;
      if (!key) return null;
      return new OpenAIEmbeddingProvider({ apiKey: key, model });
    }
    case "gemini": {
      const key = apiKey || process.env.GEMINI_API_KEY;
      if (!key) return null;
      return new GeminiEmbeddingProvider({ apiKey: key, model });
    }
    case "ollama":
      return new OllamaEmbeddingProvider({
        model,
        baseUrl: process.env.OLLAMA_URL,
      });
    default:
      return null;
  }
}
