import "server-only";
import { getKnowledgeBaseSecondsPer1000Chars } from "@/lib/settings/platform";

export async function estimateIngestionCostSeconds(characterCount: number): Promise<number> {
  const ratePerThousand = await getKnowledgeBaseSecondsPer1000Chars();
  return Math.ceil((characterCount / 1000) * ratePerThousand);
}
