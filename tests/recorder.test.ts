import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecorderController, type RecorderDeps } from "@/lib/client/recorder-controller";
import { SpeechController, type RecognitionLike } from "@/lib/client/speech-controller";
import { transcribe, transcriptionProvider } from "@/lib/transcription/providers";

class FakeTrack {
  stopped = false;
  stop() {
    this.stopped = true;
  }
}
class FakeStream {
  tracks = [new FakeTrack()];
  getTracks() {
    return this.tracks;
  }
}
class FakeMediaRecorder {
  static isTypeSupported = (t: string) => t === "audio/mp4";
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_s: unknown, opts?: { mimeType?: string }) {
    this.mimeType = opts?.mimeType ?? "";
  }
  start() {}
  stop() {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(4000)], { type: this.mimeType }) });
    this.onstop?.();
  }
}

function setup(over: Partial<RecorderDeps> = {}) {
  let t = 0;
  const streams: FakeStream[] = [];
  const getUserMedia = vi.fn(async () => {
    const s = new FakeStream();
    streams.push(s);
    return s as unknown as MediaStream;
  });
  const upload = vi.fn(async () => "מחר בשלוש פגישה עם דני");
  const deps: RecorderDeps = {
    getUserMedia,
    MediaRecorder: FakeMediaRecorder as unknown as typeof MediaRecorder,
    upload,
    now: () => t,
    ...over,
  };
  const c = new RecorderController(deps);
  return { c, getUserMedia, upload, streams, advance: (ms: number) => (t += ms) };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("recorder + server transcription", () => {
  it("one tap = one microphone request; text arrives after stop", async () => {
    const { c, getUserMedia, upload, streams, advance } = setup();
    c.start();
    await flush();
    expect(c.getSnapshot().status).toBe("recording");
    advance(4000);
    c.stop();
    await flush();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledTimes(1);
    expect((upload.mock.calls[0] as unknown as [Blob])[0].type).toBe("audio/mp4");
    expect(c.getSnapshot().status).toBe("idle");
    expect(c.take()).toBe("מחר בשלוש פגישה עם דני");
    // The microphone is released as soon as recording stops.
    expect(streams[0]!.tracks[0]!.stopped).toBe(true);
  });

  it("a failed upload keeps the recording for a retry", async () => {
    let fail = true;
    const { c, upload, advance } = setup({
      upload: vi.fn(async () => {
        if (fail) throw new Error("provider_failed");
        return "לקנות חלב";
      }),
    });
    c.start();
    await flush();
    advance(3000);
    c.stop();
    await flush();
    expect(c.getSnapshot().error).toBe("transcription");
    expect(c.getSnapshot().canRetry).toBe(true);
    fail = false;
    c.retry();
    await flush();
    expect(c.take()).toBe("לקנות חלב");
    expect(c.getSnapshot().canRetry).toBe(false);
    void upload;
  });

  it("a tap that's too short isn't sent", async () => {
    const { c, upload, advance } = setup();
    c.start();
    await flush();
    advance(200);
    c.stop();
    await flush();
    expect(upload).not.toHaveBeenCalled();
    expect(c.getSnapshot().error).toBe("no-speech");
  });

  it("denied microphone is reported, not retried", async () => {
    const err = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    const { c } = setup({ getUserMedia: vi.fn(async () => Promise.reject(err)) });
    c.start();
    await flush();
    expect(c.getSnapshot().error).toBe("not-allowed");
    expect(c.getSnapshot().status).toBe("idle");
  });

  it("cancel discards the recording and sends nothing", async () => {
    const { c, upload, advance } = setup();
    c.start();
    await flush();
    advance(3000);
    c.cancel();
    await flush();
    expect(upload).not.toHaveBeenCalled();
    expect(c.take()).toBe("");
  });

  it("stop pressed while the microphone is still opening still stops", async () => {
    const { c, upload, advance } = setup();
    c.start();
    c.stop(); // before getUserMedia resolved
    advance(1000);
    await flush();
    await flush();
    expect(c.getSnapshot().status).toBe("idle");
    void upload;
  });
});

describe("browser engine on iPhone", () => {
  class Rec implements RecognitionLike {
    lang = "";
    continuous = false;
    interimResults = false;
    maxAlternatives = 1;
    starts = 0;
    onresult: RecognitionLike["onresult"] = null;
    onerror: RecognitionLike["onerror"] = null;
    onend: RecognitionLike["onend"] = null;
    onstart: RecognitionLike["onstart"] = null;
    static last: Rec;
    constructor() {
      Rec.last = this;
    }
    start() {
      this.starts++;
    }
    stop() {
      this.onend?.();
    }
    abort() {
      this.onend?.();
    }
  }
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does not auto-restart (each restart would re-ask for the microphone)", () => {
    const c = new SpeechController(Rec, undefined, false);
    c.start();
    Rec.last.onend?.();
    vi.advanceTimersByTime(500);
    expect(Rec.last.starts).toBe(1);
    expect(c.getSnapshot().status).toBe("idle");
  });
});

describe("transcription providers", () => {
  it("picks the configured provider", () => {
    expect(transcriptionProvider({})).toBeNull();
    expect(transcriptionProvider({ OPENAI_API_KEY: "k" })).toBe("openai");
    expect(transcriptionProvider({ ELEVENLABS_API_KEY: "k" })).toBe("elevenlabs");
  });

  it("sends Hebrew audio to OpenAI with the right fields", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const form = init!.body as FormData;
      expect(form.get("language")).toBe("he");
      expect(form.get("model")).toBe("gpt-4o-transcribe");
      expect((form.get("file") as File).name).toBe("speech.m4a");
      expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
      return new Response(JSON.stringify({ text: " מחר בעשר תור לרופא " }), { status: 200 });
    });
    const text = await transcribe(new Blob(["x"], { type: "audio/mp4" }), "speech.m4a", {
      env: { OPENAI_API_KEY: "sk-test" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(text).toBe("מחר בעשר תור לרופא");
  });

  it("sends Hebrew audio to ElevenLabs with the right fields", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const form = init!.body as FormData;
      expect(form.get("language_code")).toBe("heb");
      expect((init!.headers as Record<string, string>)["xi-api-key"]).toBe("el-test");
      return new Response(JSON.stringify({ text: "לקנות חלב" }), { status: 200 });
    });
    const text = await transcribe(new Blob(["x"]), "speech.webm", {
      env: { ELEVENLABS_API_KEY: "el-test" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect(text).toBe("לקנות חלב");
  });

  it("a provider error becomes a clear failure", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 401 }));
    await expect(
      transcribe(new Blob(["x"]), "a.webm", { env: { OPENAI_API_KEY: "bad" }, fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ kind: "provider_failed", status: 401 });
  });
});
