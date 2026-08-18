# AIbooking Conversation Relay

A small standalone WebSocket service that bridges Twilio ConversationRelay to
the main AIbooking Next.js app. It exists only because Twilio needs a
WebSocket connection held open for the full length of a call, and Vercel's
serverless functions can't do that — every piece of actual logic (AI
reasoning, knowledge base, Cal.com booking) still lives in the main app and
is called over plain HTTPS from `src/server.ts`'s `handlePrompt`.

This service is deliberately not part of the Next.js build — it has its own
`package.json` and is deployed separately.

## Local development

```bash
cd relay-server
npm install
cp .env.example .env   # fill in AIBOOKING_APP_URL and CONVERSATION_RELAY_INTERNAL_SECRET
npm run dev
```

## Deploying to Fly.io

1. Install `flyctl`: https://fly.io/docs/flyctl/install/
2. `fly launch --no-deploy` from this directory — pick the `arn` (Stockholm)
   region for EU latency, and accept/adjust the generated app name.
3. Update `fly.toml`'s `app` line if flyctl picked a different name than the
   one already in the file.
4. Set secrets (must match the main app's Vercel env vars exactly):
   ```bash
   fly secrets set \
     AIBOOKING_APP_URL=https://your-app.vercel.app \
     CONVERSATION_RELAY_INTERNAL_SECRET=<a strong random value>
   ```
5. `fly deploy`
6. Note the resulting hostname (e.g. `aibooking-conversation-relay.fly.dev`)
   — set `CONVERSATION_RELAY_WS_URL=wss://<that hostname>` in the main app's
   Vercel env vars (Fly.io serves `wss://` on the same hostname as `https://`,
   no separate setup needed).

## Twilio Console setup (one-time, manual — see the main README for the full
checklist)

1. **API Key**: Console → Account → API keys & tokens → create a Standard
   key. Use its SID/Secret as `TWILIO_API_KEY_SID`/`TWILIO_API_KEY_SECRET` in
   the main app's Vercel env vars.
2. **TwiML App**: Console → Voice → TwiML → TwiML Apps → create one. Set its
   "Voice Request URL" to `https://your-app.vercel.app/api/telephony/twilio/voice/relay-start`
   (HTTP POST). Use its SID as `TWILIO_TWIML_APP_SID` in Vercel.

## Protocol

Twilio's ConversationRelay WebSocket messages this service handles:

- **Inbound** (from Twilio): `setup` (call started, carries the
  `<Parameter>` values set in the TwiML — widgetId/customerId/sessionId/
  conversationId), `prompt` (a piece of caller speech; only acted on once
  `last: true`), `interrupt` (caller talked over playback — logged only,
  since replies aren't streamed token-by-token here), `dtmf` (logged only,
  no menus in this version).
- **Outbound** (to Twilio): `text` (the AI's reply — Twilio synthesizes and
  plays it).

On WebSocket close, this service POSTs the real, server-measured call
duration to `/api/internal/conversation-relay/end` for billing — never a
client-reported timer.
