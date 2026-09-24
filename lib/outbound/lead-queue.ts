// Which lead the manual dialer offers next.
//
// Due callbacks first — someone asked to be rung at 10:00, and it is past
// 10:00 — oldest promise first. Then fresh leads in list order. Leads being
// called, already done, on do-not-call, or with a callback that is not due
// yet are not offered. "Skip" is per session (the ids in `skipped`), so a
// skipped lead comes back the next time the list is opened.
//
// Pure, so the browser uses it directly and a test can pin the order.

export interface QueueLead {
  id: string;
  status: string;
  next_call_at: string | null;
}

export function dialerQueue<T extends QueueLead>(leads: T[], now: Date, skipped: ReadonlySet<string> = new Set()): T[] {
  const nowMs = now.getTime();
  const callbacks = leads
    .filter((lead) => lead.status === "callback" && lead.next_call_at && Date.parse(lead.next_call_at) <= nowMs)
    .sort((a, b) => Date.parse(a.next_call_at!) - Date.parse(b.next_call_at!));
  const fresh = leads.filter((lead) => lead.status === "pending");
  return [...callbacks, ...fresh].filter((lead) => !skipped.has(lead.id));
}
