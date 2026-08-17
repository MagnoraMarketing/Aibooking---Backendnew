import type { KnowledgeBaseSource } from "./types";

// Simplest viable design (see conversation): the knowledge base is stuffed
// directly into the system prompt rather than chunked/embedded/retrieved —
// fine at the "a handful of pages per widget" scale this is scoped for, and
// needs no new provider (Anthropic has no embeddings API) or vector store.
// This cap is a safety net against a customer accumulating far more than
// that, not the expected case.
const MAX_TOTAL_CHARS = 20_000;

export function formatKnowledgeBaseForPrompt(sources: KnowledgeBaseSource[]): string | null {
  if (sources.length === 0) return null;

  const parts: string[] = [];
  let used = 0;

  for (const source of sources) {
    const remaining = MAX_TOTAL_CHARS - used;
    if (remaining <= 0) break;
    const content = source.content.slice(0, remaining);
    used += content.length;
    parts.push(`### ${source.label}\n${content}`);
  }

  return [
    "Brug følgende information fra virksomhedens egne kilder til at besvare spørgsmål mere præcist.",
    "Opfind ikke information der ikke findes her eller i resten af din kontekst.",
    "",
    parts.join("\n\n"),
  ].join("\n");
}
