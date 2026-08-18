import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/database/admin";
import { requireParam } from "@/lib/security";

export const dynamic = "force-dynamic";

// Fetched by Twilio's <Play> verb (see app/api/telephony/twilio/voice/turn)
// — serves the ElevenLabs audio a conversation turn already produced via
// handleConversationTurn, stored on the message row just long enough for
// this one fetch. Twilio doesn't sign media fetches the way it signs
// webhook POSTs, so this is protected only by the message id being an
// unguessable UUID — acceptable for synthesized speech audio, not a
// substitute for real access control on sensitive content.
export async function GET(_request: Request, { params }: { params: Record<string, string> }): Promise<NextResponse> {
  const messageId = requireParam(params, "messageId");
  const supabase = getAdminClient();

  const { data, error } = await supabase
    .from("conversation_messages")
    .select("audio_base64")
    .eq("id", messageId)
    .maybeSingle();

  if (error || !data?.audio_base64) {
    return new NextResponse(null, { status: 404 });
  }

  const audioBuffer = Buffer.from(data.audio_base64, "base64");
  return new NextResponse(audioBuffer, {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
  });
}
