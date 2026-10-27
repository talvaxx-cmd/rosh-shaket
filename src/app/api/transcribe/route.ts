import { TranscriptionError, transcribe, transcriptionProvider } from "@/lib/transcription/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 15 * 1024 * 1024;
const MIN_BYTES = 1000;

function extensionFor(type: string): string {
  if (type.includes("mp4") || type.includes("m4a") || type.includes("aac")) return "m4a";
  if (type.includes("ogg")) return "ogg";
  if (type.includes("wav")) return "wav";
  if (type.includes("mpeg")) return "mp3";
  return "webm";
}

/** Receives a short recording, returns its Hebrew transcript. Audio is not stored or logged. */
export async function POST(req: Request): Promise<Response> {
  if (!transcriptionProvider()) return Response.json({ error: "not_configured" }, { status: 503 });

  let audio: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("audio");
    audio = f instanceof File ? f : null;
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  if (!audio) return Response.json({ error: "bad_request" }, { status: 400 });
  if (audio.size > MAX_BYTES) return Response.json({ error: "too_large" }, { status: 413 });
  if (audio.size < MIN_BYTES) return Response.json({ error: "too_short" }, { status: 422 });
  const type = audio.type || "audio/webm";
  if (!/^(audio|video)\//.test(type)) return Response.json({ error: "bad_type" }, { status: 415 });

  try {
    const text = await transcribe(audio, `speech.${extensionFor(type)}`);
    return Response.json({ text }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const kind = e instanceof TranscriptionError ? `${e.kind}${e.status ? `_${e.status}` : ""}` : "unknown";
    console.warn(`[transcribe] failed: ${kind}`);
    if (e instanceof TranscriptionError && e.kind === "empty") return Response.json({ error: "empty" }, { status: 422 });
    return Response.json({ error: "provider_failed" }, { status: 502 });
  }
}
