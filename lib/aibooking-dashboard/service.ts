import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import { vapiFetch } from "@/lib/vapi/client";
import { ApiError } from "@/types/errors";
import {
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

async function fetchAssistantCalls(assistantId: string, since: Date): Promise<Record<string, unknown>[]> {
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

export interface AgentActivity {
  calls: DashboardCall[];
  // Per agent, why its calls could not be read — shown on the dashboard
  // instead of failing the whole page because one assistant is unreachable.
  errors: Record<string, string>;
}

export async function loadActivity(agents: DashboardAgent[], days: number): Promise<AgentActivity> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const errors: Record<string, string> = {};

  const perAgent = await Promise.all(
    agents.map(async (agent) => {
      try {
        const raw = await fetchAssistantCalls(agent.vapi_assistant_id, since);
        return raw.map((call) => normalizeCall(call, agent.id));
      } catch (err) {
        console.error(`Aibooking dashboard: could not read calls for assistant ${agent.vapi_assistant_id}:`, String(err));
        errors[agent.id] = "Samtalerne kunne ikke hentes fra Vapi lige nu.";
        return [];
      }
    })
  );

  const calls = perAgent.flat().sort((a, b) => (b.startedAt ?? b.createdAt).localeCompare(a.startedAt ?? a.createdAt));
  return { calls, errors };
}

// One call in full — transcript and recording — for the history's detail
// view. Only a call made by one of the dashboard's own agents is returned,
// so this can never be used to read a customer's call by guessing its id.
export async function loadCallDetail(callId: string): Promise<DashboardCallDetail> {
  const agents = await listDashboardAgents();

  let raw: Record<string, unknown>;
  try {
    const response = await vapiFetch(`/call/${encodeURIComponent(callId)}`, { method: "GET" });
    raw = (await response.json()) as Record<string, unknown>;
  } catch {
    throw ApiError.notFound("Samtalen blev ikke fundet i Vapi.");
  }

  const agent = agents.find((a) => a.vapi_assistant_id === raw.assistantId);
  if (!agent) throw ApiError.notFound("Samtalen tilhører ikke en af Aibooking.dk's agenter.");
  return normalizeCallDetail(raw, agent.id);
}
