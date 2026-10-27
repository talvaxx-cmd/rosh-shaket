/**
 * One speech-recognition session for the whole app (Web Speech API, he-IL).
 *
 * - A single recognizer instance is reused, so the browser's microphone
 *   permission is asked at most once per page load.
 * - Mobile browsers (notably iOS Safari) end recognition on a short pause.
 *   While the user hasn't pressed stop, the controller restarts it and keeps
 *   the text gathered so far.
 * - The microphone is only opened from a user tap; nothing listens in the background.
 */

export interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

export type RecognitionCtor = new () => RecognitionLike;

export type SpeechStatus = "idle" | "starting" | "recording" | "stopping" | "transcribing";
export type SpeechError = "not-allowed" | "no-speech" | "network" | "audio-capture" | "unsupported" | "transcription" | "other";

export interface SpeechSnapshot {
  status: SpeechStatus;
  /** Final text gathered so far (across automatic restarts). */
  text: string;
  /** Words still being recognized. */
  interim: string;
  error: SpeechError | null;
  startedAt: number;
  /** Microphone input level 0..1 (server engine only). */
  level: number;
  /** A recording is kept after a failed transcription and can be re-sent. */
  canRetry: boolean;
  /** "browser" = Web Speech API, "server" = recorded audio transcribed on the server. */
  engine: "browser" | "server";
}

/** What the app needs from either speech engine. */
export interface EngineController {
  readonly engine: "browser" | "server";
  readonly supported: boolean;
  subscribe(l: () => void): () => void;
  getSnapshot(): SpeechSnapshot;
  start(): void;
  stop(): void;
  cancel(): void;
  take(): string;
  retry(): void;
  clearError(): void;
}

const MAX_RESTARTS = 60;
const MAX_SESSION_MS = 5 * 60 * 1000;
const RESTART_DELAY_MS = 150;
const STOP_GRACE_MS = 2000;

const FATAL: Record<string, SpeechError> = {
  "not-allowed": "not-allowed",
  "service-not-allowed": "not-allowed",
  "audio-capture": "audio-capture",
  network: "network",
  "language-not-supported": "other",
};

function join(a: string, b: string): string {
  return [a.trim(), b.trim()].filter(Boolean).join(" ");
}

export class SpeechController implements EngineController {
  readonly engine = "browser" as const;
  private rec: RecognitionLike | null = null;
  private listeners = new Set<() => void>();
  private want = false;
  private discard = false;
  private restarts = 0;
  private committed = "";
  private sessionFinal = "";
  private sessionInterim = "";
  private status: SpeechStatus = "idle";
  private error: SpeechError | null = null;
  private startedAt = 0;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;
  private snap: SpeechSnapshot;

  /**
   * @param autoRestart keep listening after the browser's own pause. Off on iPhone,
   *   where every restart makes Safari ask for the microphone again.
   */
  constructor(
    private readonly ctor: RecognitionCtor | null,
    private readonly now: () => number = () => Date.now(),
    private readonly autoRestart = true,
  ) {
    this.snap = this.build();
  }

  get supported(): boolean {
    return this.ctor !== null;
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
      text: join(this.committed, this.sessionFinal),
      interim: this.sessionInterim,
      error: this.error,
      startedAt: this.startedAt,
      level: 0,
      canRetry: false,
      engine: this.engine,
    };
  }

  private emit() {
    this.snap = this.build();
    for (const l of this.listeners) l();
  }

  private ensure(): RecognitionLike {
    if (this.rec) return this.rec;
    const r = new this.ctor!();
    r.lang = "he-IL";
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onstart = () => {
      if (this.status === "starting") {
        this.status = "recording";
        this.emit();
      }
    };
    r.onresult = (e) => {
      let fin = "";
      let mid = "";
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i]!;
        const t = res[0]?.transcript ?? "";
        if (res.isFinal) fin = join(fin, t);
        else mid = join(mid, t);
      }
      this.sessionFinal = fin;
      this.sessionInterim = mid;
      if (this.status === "starting") this.status = "recording";
      this.emit();
    };
    r.onerror = (e) => {
      const fatal = FATAL[e.error];
      if (fatal) {
        this.want = false;
        this.error = fatal;
        this.emit();
      }
      // "no-speech" / "aborted": not fatal — onend decides whether to continue.
    };
    r.onend = () => this.handleEnd();
    this.rec = r;
    return r;
  }

  private handleEnd() {
    if (this.discard) {
      this.discard = false;
      this.sessionFinal = "";
      this.sessionInterim = "";
    } else {
      // Keep everything heard in this round, including words not yet marked final.
      this.committed = join(this.committed, join(this.sessionFinal, this.sessionInterim));
      this.sessionFinal = "";
      this.sessionInterim = "";
    }

    const withinLimits = this.restarts < MAX_RESTARTS && this.now() - this.startedAt < MAX_SESSION_MS;
    if (this.want && this.autoRestart && withinLimits) {
      this.restarts++;
      setTimeout(() => {
        if (!this.want) return this.finish();
        try {
          this.rec!.start();
        } catch {
          this.want = false;
          this.finish();
        }
      }, RESTART_DELAY_MS);
      this.emit();
      return;
    }
    this.want = false;
    this.finish();
  }

  private finish() {
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = null;
    this.status = "idle";
    this.emit();
  }

  /** Must be called from a user gesture (tap) — browsers require it for the microphone. */
  start() {
    if (!this.ctor) {
      this.error = "unsupported";
      this.emit();
      return;
    }
    if (this.status !== "idle") return;
    this.want = true;
    this.discard = false;
    this.error = null;
    this.restarts = 0;
    this.startedAt = this.now();
    this.status = "starting";
    this.emit();
    try {
      this.ensure().start();
    } catch {
      // Already running (e.g. a restart in flight) — treat as recording.
      this.status = "recording";
      this.emit();
    }
  }

  stop() {
    if (this.status === "idle") return;
    this.want = false;
    this.status = "stopping";
    this.emit();
    try {
      this.rec?.stop();
    } catch {}
    // Some browsers occasionally never fire `end` after stop().
    this.stopTimer = setTimeout(() => {
      if (this.status === "stopping") this.handleEnd();
    }, STOP_GRACE_MS);
  }

  cancel() {
    this.want = false;
    this.committed = "";
    if (this.status !== "idle") {
      this.discard = true;
      try {
        this.rec?.abort();
      } catch {}
    }
    this.sessionFinal = "";
    this.sessionInterim = "";
    this.finish();
  }

  /** Hands over the gathered text and clears it. */
  take(): string {
    const t = join(this.committed, this.sessionFinal);
    this.committed = "";
    this.sessionFinal = "";
    this.emit();
    return t;
  }

  /** Nothing to re-send: the browser engine keeps no audio. */
  retry() {}

  clearError() {
    this.error = null;
    this.emit();
  }
}

export function browserRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
