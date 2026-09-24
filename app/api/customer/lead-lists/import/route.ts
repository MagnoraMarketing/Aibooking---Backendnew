import { NextResponse } from "next/server";
import { requireCustomerAdmin } from "@/lib/auth";
import { getAdminClient } from "@/lib/database/admin";
import { readJsonBody, withErrorHandling, writeAuditLog, leadImportSchema } from "@/lib/security";
import { normalizePhone } from "@/lib/outbound/phone";
import { suppressedNumbers } from "@/lib/outbound/suppression";
import { ApiError } from "@/types/errors";

export const dynamic = "force-dynamic";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Imports one chunk of leads into a list — a CSV upload (sent in chunks by
// the browser) or a single "add lead manually".
//
// Every row is validated again here with the same normalizer the preview
// used; the preview is what the customer looked at, this is the gate.
// Numbers on the customer's do-not-call list are never imported.
//
// duplicateMode decides what happens to a number the customer already has:
//   skip   — leave it out (default)
//   import — add it anyway
//   update — refresh the existing lead's details instead of adding one
export const POST = withErrorHandling(async (request) => {
  const ctx = await requireCustomerAdmin();
  const customerId = ctx.profile.customer_id!;
  const body = await readJsonBody(request, leadImportSchema);
  const supabase = getAdminClient();

  let listId = body.listId ?? null;
  let createdList = false;
  if (listId) {
    const { data: list, error } = await supabase
      .from("lead_lists")
      .select("id, customer_id")
      .eq("id", listId)
      .maybeSingle();
    if (error) throw error;
    if (!list || list.customer_id !== customerId) throw ApiError.notFound("Lead list not found");
  } else {
    const { data: list, error } = await supabase
      .from("lead_lists")
      .insert({ customer_id: customerId, name: body.newListName! })
      .select("id")
      .single();
    if (error) throw error;
    listId = list.id;
    createdList = true;
  }

  let invalid = 0;
  const seen = new Set<string>();
  const rows: {
    phone_number: string;
    contact_name: string | null;
    company: string | null;
    email: string | null;
    notes: string | null;
    custom_data: Record<string, string>;
  }[] = [];
  let duplicatesInChunk = 0;

  for (const lead of body.leads) {
    const phone = normalizePhone(lead.phone, body.defaultCountry);
    const email = lead.email?.trim() || null;
    if (!phone.ok || (email && !EMAIL_REGEX.test(email))) {
      invalid += 1;
      continue;
    }
    if (seen.has(phone.e164)) {
      duplicatesInChunk += 1;
      continue;
    }
    seen.add(phone.e164);
    rows.push({
      phone_number: phone.e164,
      contact_name: lead.name?.trim() || null,
      company: lead.company?.trim() || null,
      email,
      notes: lead.notes?.trim() || null,
      custom_data: lead.customData ?? {},
    });
  }

  const suppressed = await suppressedNumbers(
    customerId,
    rows.map((row) => row.phone_number)
  );
  const allowed = rows.filter((row) => !suppressed.has(row.phone_number));

  // What the customer already has under these numbers, in any list.
  const existing: { id: string; list_id: string; phone_number: string; custom_data: Record<string, string> }[] = [];
  const phones = allowed.map((row) => row.phone_number);
  for (let i = 0; i < phones.length; i += 300) {
    const { data, error } = await supabase
      .from("leads")
      .select("id, list_id, phone_number, custom_data")
      .eq("customer_id", customerId)
      .in("phone_number", phones.slice(i, i + 300));
    if (error) throw error;
    existing.push(...(data ?? []));
  }
  const existingByPhone = new Map<string, (typeof existing)[number]>();
  for (const row of existing) {
    // Prefer the lead in the list being imported into.
    const current = existingByPhone.get(row.phone_number);
    if (!current || (row.list_id === listId && current.list_id !== listId)) existingByPhone.set(row.phone_number, row);
  }

  const toInsert: typeof allowed = [];
  let updated = 0;
  let skippedDuplicates = duplicatesInChunk;

  for (const row of allowed) {
    const match = existingByPhone.get(row.phone_number);
    if (!match || body.duplicateMode === "import") {
      toInsert.push(row);
      continue;
    }
    if (body.duplicateMode === "skip") {
      skippedDuplicates += 1;
      continue;
    }
    // update: only fields the import actually carries, so a sparse re-upload
    // does not blank out what is already known.
    const patch: Record<string, unknown> = { custom_data: { ...(match.custom_data ?? {}), ...row.custom_data } };
    if (row.contact_name) patch.contact_name = row.contact_name;
    if (row.company) patch.company = row.company;
    if (row.email) patch.email = row.email;
    if (row.notes) patch.notes = row.notes;
    const { error } = await supabase.from("leads").update(patch).eq("id", match.id).eq("customer_id", customerId);
    if (error) throw error;
    updated += 1;
  }

  if (toInsert.length > 0) {
    const { error } = await supabase
      .from("leads")
      .insert(toInsert.map((row) => ({ ...row, list_id: listId, customer_id: customerId })));
    if (error) {
      if (createdList) await supabase.from("lead_lists").delete().eq("id", listId);
      throw error;
    }
  }

  await writeAuditLog({
    actorId: ctx.userId,
    actorRole: ctx.profile.role,
    customerId,
    action: "lead_list.imported",
    entityType: "lead_list",
    entityId: listId!,
    metadata: {
      inserted: toInsert.length,
      updated,
      skippedDuplicates,
      suppressed: suppressed.size,
      invalid,
      duplicateMode: body.duplicateMode,
    },
  });

  return NextResponse.json({
    listId,
    inserted: toInsert.length,
    updated,
    skippedDuplicates,
    suppressed: rows.length - allowed.length,
    invalid,
  });
});
