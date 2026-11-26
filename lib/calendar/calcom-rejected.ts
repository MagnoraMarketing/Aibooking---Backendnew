import "server-only";
import { getAdminClient } from "@/lib/database/admin";
import { bookingFailureKind } from "./booking-failure";

// A pasted Cal.com API key that Cal.com no longer accepts (revoked,
// regenerated, or the account deleted) used to stay "connected" forever.
// Every availability lookup then failed mid-conversation with "Ugyldig
// Cal.com API-nøgle", the agent could only apologise, and because Cal.com
// takes priority over Google/Outlook, a calendar the business had connected
// since was never even tried. Nothing in the dashboard said anything was
// wrong: the connection still showed green.
//
// So a rejected key is recorded where the customer can see it (the
// connection turns red, and "Test forbindelse" flips it back once a working
// key is in place), and the caller is told whether it should fall back to
// the widget's next calendar.
//
// Returns true when the error was a credentials rejection.
export async function handleRejectedCalcomKey(widgetId: string, err: unknown): Promise<boolean> {
  if (bookingFailureKind(err) !== "credentials") return false;

  console.error(
    `Cal.com rejected the stored API key for widget ${widgetId}; marking the connection as error and falling back.`
  );

  try {
    const { error } = await getAdminClient()
      .from("calendar_connections")
      .update({ status: "error" })
      .eq("widget_id", widgetId)
      .eq("provider", "calcom")
      .eq("status", "connected");
    if (error) console.error("Failed to mark Cal.com connection as error:", error);
  } catch (updateErr) {
    console.error("Failed to mark Cal.com connection as error:", updateErr);
  }

  return true;
}

// What the agent says when the rejected key was the only calendar.
export const CALENDAR_NOT_WORKING =
  "Kalenderen er ikke forbundet korrekt lige nu, så du kan ikke se ledige tider eller booke. Det er ikke noget kunden kan rette. " +
  "Sig undskyld, tag imod kundens navn, e-mail og ønskede tidspunkt, og lov at virksomheden vender tilbage.";
