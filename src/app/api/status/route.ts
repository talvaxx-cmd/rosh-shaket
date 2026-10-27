import { EXTRACTION_MODEL, hasClaudeCredentials } from "@/lib/extraction/claude";
import { transcriptionProvider } from "@/lib/transcription/providers";

export const dynamic = "force-dynamic";

export function GET() {
  const ai = hasClaudeCredentials();
  return Response.json({
    extraction: ai ? "ai" : "rules",
    model: ai ? EXTRACTION_MODEL : null,
    transcription: transcriptionProvider(),
  });
}
