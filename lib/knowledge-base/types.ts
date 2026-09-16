export type KnowledgeBaseSourceType = "text" | "url" | "pdf";

export interface KnowledgeBaseSource {
  id: string;
  type: KnowledgeBaseSourceType;
  label: string;
  content: string;
  characterCount: number;
  costSeconds: number;
  createdAt: string;
}
