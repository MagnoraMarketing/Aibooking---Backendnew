import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";

// ---------------------------------------------------------------------------
// AIbooking Conversation Relay — a thin, stateless-per-call bridge between
// Twilio ConversationRelay's WebSocket and the AIbooking Next.js backend.
//
// This is deliberately dumb: it does no AI reasoning, no knowledge-base
// lookup, no Cal.com booking — all of that lives in the main app
// (lib/conversation/handle-turn.ts's generateConversationReplyText) and is
// reached over plain HTTPS, exactly as if this were just another customer
// request. This service's only two jobs are (1) hold the long-lived
// WebSocket connection Twilio requires — something Vercel's serverless
// functions structurally cannot do — and (2) measure real call duration for
// billing (see /end below).
//
// Message shapes below follow Twilio's ConversationRelay WebSocket protocol
// (https://www.twilio.com/docs/voice/conversationrelay/websocket-messages):
// inbound "setup" / "prompt" / "interrupt" / "dtmf" / "error", outbound
// "text" / "end" / "language" / "error".
// ---------------------------------------------------------------------------

const PORT = Number(process.env.PORT ?? 8080);
const AIBOOKING_APP_URL = process.env.AIBOOKING_APP_URL;
const INTERNAL_SECRET = process.env.CONVERSATION_RELAY_INTERNAL_SECRET;

if (!AIBOOKING_APP_URL || !INTERNAL_SECRET) {
  console.error("Missing required env vars: AIBOOKING_APP_URL, CONVERSATION_RELAY_INTERNAL_SECRET");
  process.exit(1);
}

interface SetupMessage {
  type: "setup";
  callSid?: string;
  from?: string;
  to?: string;
  customParameters?: Record<string, string>;
}

interface PromptMessage {
  type: "prompt";
  voicePrompt?: string;
  last?: boolean;
}

interface InterruptMessage {
  type: "interrupt";
  utteranceUntilInterrupt?: string;
  durationUntilInterruptMs?: number;
}

interface DtmfMessage {
  type: "dtmf";
  digit?: string;
}

interface ErrorMessage {
  type: "error";
  description?: string;
}

type InboundMessage = SetupMessage | PromptMessage | InterruptMessage | DtmfMessage | ErrorMessage | { type: string };

interface CallState {
  callSid: string | null;
  widgetId: string | null;
  customerId: string | null;
  sessionId: string | null;
  conversationId: string | null;
  startedAt: number;
}

async function callInternalApi(path: string, body: unknown): Promise<Response> {
  return fetch(`${AIBOOKING_APP_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": INTERNAL_SECRET!,
    },
    body: JSON.stringify(body),
  });
}

function send(socket: WebSocket, message: Record<string, unknown>): void {
  if (socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify(message));
}

async function handlePrompt(socket: WebSocket, state: CallState, message: PromptMessage): Promise<void> {
  const userText = message.voicePrompt?.trim();
  // ConversationRelay's speech-to-text can emit interim (non-final) prompt
  // events — only act once `last` confirms the caller has actually finished
  // their turn, otherwise the same utterance gets answered multiple times.
  if (!userText || message.last !== true) return;

  if (!state.widgetId || !state.customerId || !state.sessionId || !state.conversationId) {
    console.error(`[${state.callSid}] Received prompt before setup completed — dropping.`);
    return;
  }

  try {
    const response = await callInternalApi("/api/internal/conversation-relay/turn", {
      widgetId: state.widgetId,
      customerId: state.customerId,
      conversationId: state.conversationId,
      usageSessionId: state.sessionId,
      userText,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      console.error(`[${state.callSid}] Turn request failed (${response.status}): ${errorBody}`);
      send(socket, { type: "text", token: "Der opstod en fejl. Prøv igen.", last: true });
      return;
    }

    const data = (await response.json()) as { text: string };
    send(socket, { type: "text", token: data.text, last: true });
  } catch (err) {
    console.error(`[${state.callSid}] Turn request threw:`, err);
    send(socket, { type: "text", token: "Der opstod en fejl. Prøv igen.", last: true });
  }
}

async function notifyCallEnded(state: CallState): Promise<void> {
  if (!state.sessionId) return;
  const durationSeconds = Math.max(0, Math.round((Date.now() - state.startedAt) / 1000));
  try {
    const response = await callInternalApi("/api/internal/conversation-relay/end", {
      usageSessionId: state.sessionId,
      durationSeconds,
    });
    if (!response.ok) {
      console.error(`[${state.callSid}] End-of-call notification failed (${response.status})`);
    }
  } catch (err) {
    console.error(`[${state.callSid}] End-of-call notification threw:`, err);
  }
}

const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server });

wss.on("connection", (socket) => {
  const state: CallState = {
    callSid: null,
    widgetId: null,
    customerId: null,
    sessionId: null,
    conversationId: null,
    startedAt: Date.now(),
  };

  socket.on("message", (raw) => {
    let message: InboundMessage;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      console.error("Received non-JSON WebSocket message, ignoring.");
      return;
    }

    switch (message.type) {
      case "setup": {
        const setup = message as SetupMessage;
        state.callSid = setup.callSid ?? null;
        state.widgetId = setup.customParameters?.widgetId ?? null;
        state.customerId = setup.customParameters?.customerId ?? null;
        state.sessionId = setup.customParameters?.sessionId ?? null;
        state.conversationId = setup.customParameters?.conversationId ?? null;
        state.startedAt = Date.now();
        console.log(`[${state.callSid}] Call started (widget ${state.widgetId})`);
        break;
      }
      case "prompt":
        void handlePrompt(socket, state, message as PromptMessage);
        break;
      case "interrupt":
        // ConversationRelay handles barge-in audio itself; we send one
        // complete reply per turn (no token streaming to truncate), so
        // there's nothing further for us to do here beyond logging.
        console.log(`[${state.callSid}] Caller interrupted playback`);
        break;
      case "dtmf":
        // No DTMF menus in this version — logged for visibility only.
        console.log(`[${state.callSid}] DTMF digit received`);
        break;
      case "error":
        console.error(`[${state.callSid}] ConversationRelay reported an error:`, (message as ErrorMessage).description);
        break;
      default:
        console.log(`[${state.callSid}] Unhandled message type: ${message.type}`);
    }
  });

  socket.on("close", () => {
    console.log(`[${state.callSid}] Call ended`);
    void notifyCallEnded(state);
  });

  socket.on("error", (err) => {
    console.error(`[${state.callSid}] WebSocket error:`, err);
  });
});

server.listen(PORT, () => {
  console.log(`AIbooking Conversation Relay listening on :${PORT}`);
});
