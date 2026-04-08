import type { EmbeddingProvider } from "./provider";

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  name = "openai";
  dimensions: number;
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(options: {
    apiKey: string;
    model?: string;
    dimensions?: number;
    baseUrl?: string;
  }) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? "text-embedding-3-small";
    this.dimensions = options.dimensions ?? 1536;
    this.baseUrl = options.baseUrl ?? "https://api.openai.com/v1";
  }

  async embed(text: string): Promise<Float32Array> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input: texts,
        model: this.model,
        dimensions: this.dimensions,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI embedding failed: ${response.status} ${err}`);
    }

    const data = (await response.json()) as {
      data: { embedding: number[] }[];
    };

    return data.data.map((d) => new Float32Array(d.embedding));
  }
}
