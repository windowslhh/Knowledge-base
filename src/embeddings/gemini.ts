import type { EmbeddingProvider } from "./provider";

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  name = "gemini";
  dimensions: number;
  private apiKey: string;
  private model: string;

  constructor(options: {
    apiKey: string;
    model?: string;
    dimensions?: number;
  }) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? "text-embedding-004";
    this.dimensions = options.dimensions ?? 768;
  }

  async embed(text: string): Promise<Float32Array> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const requests = texts.map((text) => ({
      model: `models/${this.model}`,
      content: { parts: [{ text }] },
    }));

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:batchEmbedContents?key=${this.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requests }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini embedding failed: ${response.status} ${err}`);
    }

    const data = (await response.json()) as {
      embeddings: { values: number[] }[];
    };

    return data.embeddings.map((e) => new Float32Array(e.values));
  }
}
