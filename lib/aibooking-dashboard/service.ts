import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import { vapiFetch } from "@/lib/vapi/client";
import { ApiError } from "@/types/errors";
import {
  callFromStoredReport,
  retentionStartFromError,
  normalizeCall,
  normalizeCallDetail,
  type DashboardAgent,
  type DashboardCall,
  type DashboardCallDetail,
} from "./calls";

// Vapi returns at most this many calls per request; older calls are paged
// in by asking again for those created before the oldest one seen.
const PAGE_SIZE = 1000;
const MAX_PAGES = 5;

export async function listDashboardAgents(): Promise<DashboardAgent[]> {
  const { data, error } = await getAdminClient()
    .from("aibooking_dashboard_agents")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as DashboardAgent[];
}

// Refuses an id Vapi does not know, so a typo is caught when it is saved
// rather than showing up later as an agent that never has any activity.
export async function assertVapiAssistantExists(assistantId: string): Promise<string | null> {
  try {
    const response = await vapiFetch(`/assistant/${encodeURIComponent(assistantId)}`, { method: "GET" });
    const assistant = (await response.json()) as { name?: string };
    return assistant.name ?? null;
  } catch {
    throw ApiError.badRequest("Vapi kender ikke denne assistent. Tjek at ID'et er kopieret korrekt fra Vapi.");
  }
}

async function fetchAssistantCallsFrom(assistantId: string, since: Date): Promise<Record<string, unknown>[]> {
  const calls: Record<string, unknown>[] = [];
  let before: string | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const query = new URLSearchParams({
      assistantId,
      limit: String(PAGE_SIZE),
      createdAtGt: since.toISOString(),
    });
    if (before) query.set("createdAtLt", before);

    const response = await vapiFetch(`/call?${query.toString()}`, { method: "GET" });
    const batch = (await response.json()) as Record<string, unknown>[];
    if (!Array.isArray(batch) || batch.length === 0) break;
    calls.push(...batch);
    if (batch.length < PAGE_SIZE) break;

    const oldest = batch
      .map((call) => String(call.createdAt ?? ""))
      .filter(Boolean)
      .sort()[0];
    if (!oldest || oldest === before) break;
    before = oldest;
  }

  return calls;
}

// Vapi's call list only reaches back as far as the subscription's retention
// window (14 days at the time of writing) and refuses the whole request when
// asked for more, naming the oldest date it will serve. So a longer period is
// asked again from that date, and `retentionStart` tells the caller the rest
// has to come from our own log.
async function fetchAssistantCalls(
  assistantId: string,
  since: Date
): Promise<{ calls: Record<string, unknown>[]; retentionStart: Date | null }> {
  try {
    return { calls: await fetchAssistantCallsFrom(assistantId, since), retentionStart: null };
  } catch (err) {
    const retentionStart = retentionStartFromError(err instanceof Error ? err.message : String(err));
    if (!retentionStart || retentionStart <= since) throw err;
    // A minute past the named date, so a boundary measured to the second
    // cannot refuse the retry too.
    const from = new Date(retentionStart.getTime() + 60_000);
    return { calls: await fetchAssistantCallsFrom(assistantId, from), retentionStart: from };
  }
}

// Every end-of-call-report Vapi has delivered to our webhook for these
// assistants — the platform's own copy of calls, kept past Vapi's retention
// window. Only calls whose assistant's server URL points at us are here.
async function loadStoredCalls(assistantIds: string[], since: Date): Promise<Record<string, unknown>[]> {
  if (assistantIds.length === 0) return [];
  const { data, error } = await getAdminClient()
    .from("vapi_events")
    .select("payload")
    .eq("type", "end-of-call-report")
    .gte("received_at", since.toISOString())
    .in("payload->call->>assistantId", assistantIds)
    .order("received_at", { ascending: false })
    .limit(5000);
  if (error) throw error;
  return (data ?? [])
    .map((row) => callFromStoredReport((row as { payload: Record<string, unknown> }).payload))
    .filter((call): call is Record<string, unknown> => call !== null);
}

export interface AgentActivity {
  calls: DashboardCall[];
  // Per agent, why its calls could not be read — shown on the dashboard
  // instead of failing the whole page because one assistant is unreachable.
  errors: Record<string, string>;
  // Set when Vapi could not serve the whole period: the date its history
  // starts from. Older calls then come from our own log only.
  vapiHistoryFrom: string | null;
}

export async function loadActivity(agents: DashboardAgent[], days: number): Promise<AgentActivity> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const errors: Record<string, string> = {};
  const agentByAssistant = new Map(agents.map((agent) => [agent.vapi_assistant_id, agent]));
  let vapiHistoryFrom: Date | null = null;

  // Keyed by call id: Vapi's own copy wins over the stored report, which a
  // call has in both places for as long as Vapi still keeps it.
  const byId = new Map<string, DashboardCall>();

  let stored: Record<string, unknown>[] = [];
  try {
    stored = await loadStoredCalls([...agentByAssistant.keys()], since);
  } catch (err) {
    console.error("Aibooking dashboard: could not read stored call reports:", String(err));
  }
  for (const raw of stored) {
    const agent = agentByAssistant.get(String(raw.assistantId ?? ""));
    if (agent) byId.set(String(raw.id), normalizeCall(raw, agent.id));
  }

  await Promise.all(
    agents.map(async (agent) => {
      try {
        const { calls, retentionStart } = await fetchAssistantCalls(agent.vapi_assistant_id, since);
        if (retentionStart && (!vapiHistoryFrom || retentionStart > vapiHistoryFrom)) vapiHistoryFrom = retentionStart;
        for (const raw of calls) byId.set(String(raw.id), normalizeCall(raw, agent.id));
      } catch (err) {
        console.error(`Aibooking dashboard: could not read calls for assistant ${agent.vapi_assistant_id}:`, String(err));
        errors[agent.id] = "Samtalerne kunne ikke hentes fra Vapi lige nu.";
      }
    })
  );

  const calls = [...byId.values()].sort((a, b) =>
    (b.startedAt ?? b.createdAt).localeCompare(a.startedAt ?? a.createdAt)
  );
  return { calls, errors, vapiHistoryFrom: (vapiHistoryFrom as Date | null)?.toISOString() ?? null };
}

// One call in full — transcript and recording — for the history's detail
// view. Only a call made by one of the dashboard's own agents is returned,
// so this can never be used to read a customer's call by guessing its id.
export async function loadCallDetail(callId: string): Promise<DashboardCallDetail> {
  const agents = await listDashboardAgents();

  let raw: Record<string, unknown> | null = null;
  try {
    const response = await vapiFetch(`/call/${encodeURIComponent(callId)}`, { method: "GET" });
    raw = (await response.json()) as Record<string, unknown>;
  } catch {
    // Past Vapi's retention window the call is only in our own log.
    const { data } = await getAdminClient()
      .from("vapi_events")
      .select("payload")
      .eq("call_id", callId)
      .eq("type", "end-of-call-report")
      .order("received_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    raw = data ? callFromStoredReport((data as { payload: Record<string, unknown> }).payload) : null;
  }
  if (!raw) throw ApiError.notFound("Samtalen blev ikke fundet.");

  const agent = agents.find((a) => a.vapi_assistant_id === raw.assistantId);
  if (!agent) throw ApiError.notFound("Samtalen tilhører ikke en af Aibooking.dk's agenter.");
  return normalizeCallDetail(raw, agent.id);
}
