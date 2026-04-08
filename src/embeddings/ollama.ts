import type { EmbeddingProvider } from "./provider";

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  name = "ollama";
  dimensions: number;
  private model: string;
  private baseUrl: string;

  constructor(options?: {
    model?: string;
    dimensions?: number;
    baseUrl?: string;
  }) {
    this.model = options?.model ?? "nomic-embed-text";
    this.dimensions = options?.dimensions ?? 768;
    this.baseUrl = options?.baseUrl ?? "http://localhost:11434";
  }

  async embed(text: string): Promise<Float32Array> {
    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, input: text }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Ollama embedding failed: ${response.status} ${err}`);
    }

    const data = (await response.json()) as {
      embeddings: number[][];
    };

    return new Float32Array(data.embeddings[0]);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    // Ollama supports batch via the input field
    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, input: texts }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Ollama embedding failed: ${response.status} ${err}`);
    }

    const data = (await response.json()) as {
      embeddings: number[][];
    };

    return data.embeddings.map((e) => new Float32Array(e));
  }
}
