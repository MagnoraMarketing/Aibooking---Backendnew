export const TRIAL_DAYS = 7;

// New customers get full dashboard access for TRIAL_DAYS regardless of
// payment status — after that, generating the embed code (the "go live on
// a real website" step) requires either a paid subscription or a
// remaining credit balance (see hasEmbedCodeAccess below). Building and
// testing an agent stays free indefinitely; only publishing it is gated.
export function isWithinTrial(customerCreatedAt: string): boolean {
  const createdAt = new Date(customerCreatedAt).getTime();
  return Date.now() - createdAt < TRIAL_DAYS * 24 * 60 * 60 * 1000;
}

export function trialDaysRemaining(customerCreatedAt: string): number {
  const createdAt = new Date(customerCreatedAt).getTime();
  const remainingMs = TRIAL_DAYS * 24 * 60 * 60 * 1000 - (Date.now() - createdAt);
  return Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
}

export function hasEmbedCodeAccess(params: {
  customerCreatedAt: string;
  subscriptionStatus: string | null | undefined;
  balanceSeconds: number;
}): boolean {
  return (
    isWithinTrial(params.customerCreatedAt) ||
    params.subscriptionStatus === "active" ||
    params.balanceSeconds > 0
  );
}
