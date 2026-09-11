import "server-only";
import Stripe from "stripe";
import { requireCredentialEnv } from "@/lib/security/env";

let client: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (client) return client;
  // requireCredentialEnv rather than a bare throw: a plain Error reaches the
  // customer as "Something went wrong" (errorResponse masks non-ApiError
  // throws), which for the Bestil-knap is indistinguishable from any other
  // failure. Same treatment as the Anthropic and Vapi clients.
  const secretKey = requireCredentialEnv(
    "STRIPE_SECRET_KEY",
    "Betaling er ikke konfigureret endnu (mangler STRIPE_SECRET_KEY i miljøvariablerne på Vercel)."
  );
  client = new Stripe(secretKey, { apiVersion: "2025-02-24.acacia" });
  return client;
}
