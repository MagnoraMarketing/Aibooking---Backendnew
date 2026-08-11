export function estimateLLMCost(params: {
  inputTokens: number;
  outputTokens: number;
  inputPricePerMillion: number;
  outputPricePerMillion: number;
}): number {
  const inputCost = (params.inputTokens / 1_000_000) * params.inputPricePerMillion;
  const outputCost = (params.outputTokens / 1_000_000) * params.outputPricePerMillion;
  return inputCost + outputCost;
}
