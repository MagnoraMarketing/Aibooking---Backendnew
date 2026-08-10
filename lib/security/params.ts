import { ApiError } from "@/types/errors";

// tsconfig has noUncheckedIndexedAccess on, so indexing route params
// (which Next.js types as a plain string-keyed object) yields
// `string | undefined`. This both narrows the type and validates the
// route actually matched a non-empty segment.
export function requireParam(params: Record<string, string | undefined>, key: string): string {
  const value = params[key];
  if (!value) throw ApiError.badRequest(`Missing route parameter: ${key}`);
  return value;
}
