// What saving an edited contact list should do to the list already stored.
//
// In a draft the textarea simply IS the list, so it replaces what is there.
// Once the dialer has been let at it, a contact is not a line of text any
// more: it may carry an attempt, a result, a recording and a billing record.
// So the list is merged instead — added, corrected, and removed only where
// removing throws nothing away.
//
// Kept as a plain function over plain rows, with no database in it, because
// the rule it encodes is the one that must never be got wrong: a contact
// that has been called is not deleted because somebody edited a textarea.

export interface ExistingContact {
  id: string;
  phone_number: string;
  contact_name: string | null;
  company: string | null;
  status: string;
  attempts: number | null;
  last_called_at: string | null;
}

export interface ContactInput {
  phoneNumber: string;
  name?: string;
  company?: string;
}

export interface ContactListPlan {
  insert: ContactInput[];
  // Only the labels. Status, attempts, results and the call record are what
  // happened; an edit to a name does not touch them.
  update: { id: string; contact_name: string | null; company: string | null }[];
  delete: string[];
  // Contacts the edit asked to drop that are kept anyway, because they have
  // a call behind them. Counted so the dashboard can say so rather than
  // showing a list that is not the list that was saved.
  keptBecauseCalled: number;
}

// Nothing has happened to this contact, so removing it removes nothing.
function untouched(row: ExistingContact): boolean {
  return row.status === "pending" && (row.attempts ?? 0) === 0 && !row.last_called_at;
}

export function planContactList(
  existing: ExistingContact[],
  wanted: ContactInput[],
  options: { replaceAll: boolean }
): ContactListPlan {
  const plan: ContactListPlan = { insert: [], update: [], delete: [], keptBecauseCalled: 0 };

  if (options.replaceAll) {
    plan.delete = existing.map((row) => row.id);
    plan.insert = wanted;
    return plan;
  }

  // The number is what identifies a person here: it is the only field the
  // campaign acts on, and the one the customer retypes when editing.
  const byNumber = new Map<string, ContactInput>();
  for (const contact of wanted) byNumber.set(contact.phoneNumber, contact);

  for (const row of existing) {
    const match = byNumber.get(row.phone_number);

    if (!match) {
      if (untouched(row)) plan.delete.push(row.id);
      else plan.keptBecauseCalled += 1;
      continue;
    }

    byNumber.delete(row.phone_number);

    const contactName = match.name ?? null;
    const company = match.company ?? null;
    if (contactName !== row.contact_name || company !== row.company) {
      plan.update.push({ id: row.id, contact_name: contactName, company });
    }
  }

  plan.insert = [...byNumber.values()];
  return plan;
}
