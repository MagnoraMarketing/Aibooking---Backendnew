// ElevenLabs bills per character. Admin can override the rate via env
// without a code change; falls back to a conservative published-tier rate.
const DEFAULT_PRICE_PER_1K_CHARACTERS_DKK = 1.1;

export function estimateTTSCost(charactersUsed: number): number {
  const pricePer1k = Number(process.env.ELEVENLABS_PRICE_PER_1K_CHARACTERS_DKK) || DEFAULT_PRICE_PER_1K_CHARACTERS_DKK;
  return (charactersUsed / 1000) * pricePer1k;
}
