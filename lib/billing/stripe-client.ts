import "server-only";
import Stripe from "stripe";

let client: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (client) return client;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error("Missing required environment variable: STRIPE_SECRET_KEY");
  client = new Stripe(secretKey, { apiVersion: "2025-02-24.acacia" });
  return client;
}
