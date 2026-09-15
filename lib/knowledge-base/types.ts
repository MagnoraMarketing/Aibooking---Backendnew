// "shopify" is not something the customer adds by hand: it is the single
// source the Shopify integration writes and replaces on every sync (see
// lib/shopify/sync.ts). It lives in the same array as the rest so it reaches
// the prompt through exactly one path — formatKnowledgeBaseForPrompt — rather
// than a parallel mechanism only the webshop feature knows about.
export type KnowledgeBaseSourceType = "text" | "url" | "pdf" | "shopify";

export interface KnowledgeBaseSource {
  id: string;
  type: KnowledgeBaseSourceType;
  label: string;
  content: string;
  characterCount: number;
  costSeconds: number;
  createdAt: string;
}
