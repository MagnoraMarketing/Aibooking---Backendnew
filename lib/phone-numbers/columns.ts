// Columns safe to send back to a browser (customer dashboard or admin
// dashboard) — every phone_numbers column except twilio_account_sid and
// twilio_auth_token (0021_byo_twilio_direct.sql). Those two hold a live
// Twilio credential the customer typed in during a BYO-Twilio import; they
// must never round-trip into a page's props or an API JSON response, even
// back to the same customer who supplied them — it just widens that
// secret's exposure (page source, browser devtools, RSC payload caches)
// for no benefit, since nothing client-side ever needs to read it back.
// Server-only code that actually calls Twilio on a BYO number's behalf
// (lib/telephony/resolve.ts, lib/phone-numbers/service.ts) still uses
// select("*") directly — this constant is only for responses that reach a
// browser. Matches the `PhoneNumber` type in types/database.ts exactly,
// which already omits both columns.
export const PHONE_NUMBER_CLIENT_COLUMNS =
  "id, customer_id, widget_id, vapi_phone_number_id, phone_number, label, created_at, source, twilio_sid, monthly_price_dkk, purchase_status, direction, stripe_checkout_session_id, stripe_subscription_id, failure_reason, released_at";
