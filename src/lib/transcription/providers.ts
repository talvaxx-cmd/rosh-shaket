/**
 * Server-side speech-to-text. Kept free of framework imports so it can be unit-tested.
 * Audio is sent to the configured provider for transcription only and is not stored.
 */

export type TranscriptionProvider = "openai" | "elevenlabs";

export function transcriptionProvider(env: Record<string, string | undefined> = process.env): TranscriptionProvider | null {
  if (env.OPENAI_API_KEY) return "openai";
  if (env.ELEVENLABS_API_KEY) return "elevenlabs";
  return null;
}

export class TranscriptionError extends Error {
  constructor(
    readonly kind: "provider_failed" | "timeout" | "empty",
    readonly status?: number,
  ) {
    super(kind);
  }
}

/** Words the recognizer should expect — helps with Hebrew scheduling vocabulary. */
const VOCAB_HINT = "פגישה, משימה, תזכורת, מחר, מחרתיים, בשלוש, בבוקר, בערב, יום ראשון, תור לרופא, להכין, לקנות, לתאם.";

export async function transcribe(
  audio: Blob,
  filename: string,
  opts: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<string> {
  const env = opts.env ?? process.env;
  const doFetch = opts.fetchImpl ?? fetch;
  const provider = transcriptionProvider(env);
  if (!provider) throw new TranscriptionError("provider_failed");
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 60_000);

  const form = new FormData();
  form.append("file", audio, filename);
  let res: Response;
  try {
    if (provider === "openai") {
      form.append("model", env.TRANSCRIBE_MODEL || "gpt-4o-transcribe");
      form.append("language", "he");
      form.append("response_format", "json");
      form.append("prompt", VOCAB_HINT);
      res = await doFetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
        body: form,
        signal,
      });
    } else {
      form.append("model_id", env.TRANSCRIBE_MODEL || "scribe_v1");
      form.append("language_code", "heb");
      form.append("tag_audio_events", "false");
      res = await doFetch("https://api.elevenlabs.io/v1/speech-to-text", {
        method: "POST",
        headers: { "xi-api-key": env.ELEVENLABS_API_KEY! },
        body: form,
        signal,
      });
    }
  } catch (e) {
    throw new TranscriptionError(e instanceof Error && e.name === "TimeoutError" ? "timeout" : "provider_failed");
  }
  if (!res.ok) throw new TranscriptionError("provider_failed", res.status);
  const data = (await res.json()) as { text?: unknown };
  const text = typeof data.text === "string" ? data.text.trim() : "";
  if (!text) throw new TranscriptionError("empty");
  return text;
}
