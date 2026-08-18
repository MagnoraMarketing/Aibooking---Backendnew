import "server-only";
import { vapiFetch } from "./client";

export interface CreateOutboundCallParams {
  assistantId: string;
  phoneNumberId: string;
  customerNumber: string;
}

export async function createOutboundCall(params: CreateOutboundCallParams): Promise<{ id: string }> {
  const response = await vapiFetch("/call", {
    method: "POST",
    body: JSON.stringify({
      assistantId: params.assistantId,
      phoneNumberId: params.phoneNumberId,
      customer: { number: params.customerNumber },
    }),
  });
  const data = (await response.json()) as { id: string };
  return { id: data.id };
}
