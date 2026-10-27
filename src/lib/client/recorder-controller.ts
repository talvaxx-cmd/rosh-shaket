/**
 * Records audio in the browser (MediaRecorder) and has the server transcribe it.
 * Reliable on iPhone, where the built-in Web Speech API breaks off and re-asks
 * for the microphone on every restart.
 *
 * - The microphone opens only from a tap and closes as soon as recording stops.
 * - A failed upload keeps the recording, so the user can retry without re-speaking.
 */

import type { EngineController, SpeechError, SpeechSnapshot } from "./speech-controller";

export interface RecorderDeps {
  getUserMedia: () => Promise<MediaStream>;
  MediaRecorder: typeof MediaRecorder;
  upload: (audio: Blob) => Promise<string>;
  /** Optional input level meter, 0..1. */
  meter?: (stream: MediaStream) => { level(): number; close(): void };
  now?: () => number;
}

const MAX_RECORDING_MS = 3 * 60 * 1000;
const MIN_RECORDING_MS = 600;
const PREFERRED_TYPES = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];

function join(a: string, b: string): string {
  return [a.trim(), b.trim()].filter(Boolean).join(" ");
}

export class RecorderController implements EngineController {
  readonly engine = "server" as const;
  private listeners = new Set<() => void>();
  private status: SpeechSnapshot["status"] = "idle";
  private error: SpeechError | null = null;
  private committed = "";
  private startedAt = 0;
  private level = 0;
  private stream: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private discard = false;
  private stopRequested = false;
  private lastBlob: Blob | null = null;
  private uploadToken = 0;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;
  private meterTimer: ReturnType<typeof setInterval> | null = null;
  private meter: { level(): number; close(): void } | null = null;
  private snap: SpeechSnapshot;
  private readonly now: () => number;

  constructor(private readonly deps: RecorderDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.snap = this.build();
  }

  get supported(): boolean {
    return true;
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  getSnapshot = (): SpeechSnapshot => this.snap;

  private build(): SpeechSnapshot {
    return {
      status: this.status,
      text: this.committed,
      interim: "",
      error: this.error,
      startedAt: this.startedAt,
      level: this.level,
      canRetry: this.lastBlob !== null && this.status === "idle",
      engine: this.engine,
    };
  }

  private emit() {
    this.snap = this.build();
    for (const l of this.listeners) l();
  }

  private releaseMic() {
    if (this.maxTimer) clearTimeout(this.maxTimer);
    if (this.meterTimer) clearInterval(this.meterTimer);
    this.maxTimer = null;
    this.meterTimer = null;
    this.meter?.close();
    this.meter = null;
    this.level = 0;
    for (const t of this.stream?.getTracks() ?? []) t.stop();
    this.stream = null;
  }

  private pickType(): string | undefined {
    const MR = this.deps.MediaRecorder;
    return PREFERRED_TYPES.find((t) => typeof MR.isTypeSupported === "function" && MR.isTypeSupported(t));
  }

  /** Call from the tap itself — browsers only open the microphone from a user gesture. */
  start() {
    if (this.status !== "idle") return;
    this.error = null;
    this.discard = false;
    this.stopRequested = false;
    this.lastBlob = null;
    this.status = "starting";
    this.emit();

    this.deps
      .getUserMedia()
      .then((stream) => {
        if (this.discard || this.status !== "starting") {
          for (const t of stream.getTracks()) t.stop();
          return;
        }
        this.stream = stream;
        const type = this.pickType();
        const rec = new this.deps.MediaRecorder(stream, type ? { mimeType: type } : undefined);
        this.chunks = [];
        rec.ondataavailable = (e: BlobEvent) => {
          if (e.data && e.data.size > 0) this.chunks.push(e.data);
        };
        rec.onstop = () => this.onStopped(rec.mimeType || type || "audio/webm");
        this.rec = rec;
        rec.start(1000);
        this.startedAt = this.now();
        this.status = "recording";
        this.maxTimer = setTimeout(() => this.stop(), MAX_RECORDING_MS);
        if (this.deps.meter) {
          try {
            this.meter = this.deps.meter(stream);
            this.meterTimer = setInterval(() => {
              const next = Math.round((this.meter?.level() ?? 0) * 20) / 20;
              if (next !== this.level) {
                this.level = next;
                this.emit();
              }
            }, 100);
          } catch {
            this.meter = null;
          }
        }
        this.emit();
        if (this.stopRequested) this.stop();
      })
      .catch((err: unknown) => {
        const name = err instanceof Error ? err.name : "";
        this.error = name === "NotAllowedError" || name === "SecurityError" ? "not-allowed" : name === "NotFoundError" ? "audio-capture" : "other";
        this.status = "idle";
        this.emit();
      });
  }

  stop() {
    if (this.status === "starting") {
      this.stopRequested = true;
      return;
    }
    if (this.status !== "recording" || !this.rec) return;
    this.status = "stopping";
    this.emit();
    try {
      this.rec.stop();
    } catch {
      this.onStopped(this.rec.mimeType || "audio/webm");
    }
  }

  private onStopped(type: string) {
    const duration = this.now() - this.startedAt;
    this.releaseMic();
    this.rec = null;
    if (this.discard) {
      this.discard = false;
      this.chunks = [];
      return;
    }
    const blob = new Blob(this.chunks, { type });
    this.chunks = [];
    if (duration < MIN_RECORDING_MS || blob.size < 1000) {
      this.error = "no-speech";
      this.status = "idle";
      this.emit();
      return;
    }
    void this.send(blob);
  }

  private async send(blob: Blob) {
    const token = ++this.uploadToken;
    this.lastBlob = blob;
    this.error = null;
    this.status = "transcribing";
    this.emit();
    try {
      const text = await this.deps.upload(blob);
      if (token !== this.uploadToken) return;
      this.lastBlob = null;
      if (!text.trim()) this.error = "no-speech";
      else this.committed = join(this.committed, text);
    } catch (e) {
      if (token !== this.uploadToken) return;
      this.error = e instanceof Error && e.message === "empty" ? "no-speech" : "transcription";
    }
    this.status = "idle";
    this.emit();
  }

  /** Re-sends the last recording after a failed transcription. */
  retry() {
    if (this.status !== "idle" || !this.lastBlob) return;
    void this.send(this.lastBlob);
  }

  cancel() {
    this.uploadToken++;
    this.committed = "";
    this.lastBlob = null;
    if (this.status === "recording" || this.status === "stopping") {
      this.discard = true;
      try {
        this.rec?.stop();
      } catch {
        this.releaseMic();
      }
    } else if (this.status === "starting") {
      this.discard = true;
    }
    this.status = "idle";
    this.emit();
  }

  take(): string {
    const t = this.committed;
    this.committed = "";
    this.emit();
    return t;
  }

  clearError() {
    this.error = null;
    this.emit();
  }
}

/** Browser wiring: microphone, recorder, level meter and upload to /api/transcribe. */
export function browserRecorderDeps(): RecorderDeps | null {
  if (typeof window === "undefined" || typeof window.MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;
  return {
    getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }),
    MediaRecorder: window.MediaRecorder,
    upload: async (audio) => {
      const form = new FormData();
      form.append("audio", audio, "speech");
      const res = await fetch("/api/transcribe", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `http_${res.status}`);
      return data.text ?? "";
    },
    meter: (stream) => {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) throw new Error("no audio context");
      const ctx = new AC();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      return {
        level: () => {
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (const v of buf) sum += ((v - 128) / 128) ** 2;
          return Math.min(1, Math.sqrt(sum / buf.length) * 4);
        },
        close: () => void ctx.close().catch(() => undefined),
      };
    },
  };
}
