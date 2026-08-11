// Average spoken-Danish rate used to estimate turn duration when the widget
// client doesn't report an actual measured playback duration.
const CHARACTERS_PER_SECOND = 14.5;

export function estimateSpeechDurationSeconds(characterCount: number): number {
  return characterCount / CHARACTERS_PER_SECOND;
}
