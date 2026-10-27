"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { RecorderController, browserRecorderDeps } from "./recorder-controller";
import { SpeechController, browserRecognitionCtor, type EngineController, type SpeechError } from "./speech-controller";

export type { SpeechError, SpeechStatus } from "./speech-controller";

export const SPEECH_ERROR_TEXT: Record<SpeechError, string> = {
  "not-allowed": "אין הרשאה למיקרופון. אפשר לאשר בהגדרות הדפדפן, או להקליד.",
  "no-speech": "לא נשמע דיבור. נסו שוב או הקלידו.",
  network: "התמלול דורש חיבור לרשת. אפשר להקליד בינתיים.",
  "audio-capture": "לא נמצא מיקרופון פעיל.",
  unsupported: "הדפדפן הזה לא תומך בהקלטה. אפשר להקליד — זה עובד בדיוק אותו דבר.",
  transcription: "התמלול נכשל (רשת או שירות). ההקלטה לא אבדה — אפשר לנסות שוב.",
  other: "התמלול נכשל. נסו שוב או הקלידו.",
};

/** Remembers whether the server can transcribe, so the right engine is ready on the first tap. */
const SERVER_STT_KEY = "rosh-shaket:server-stt";

/** iPhone / iPad Safari, where the site's microphone permission is set per website. */
export function isAppleMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function makeController(serverStt: boolean): EngineController {
  const deps = serverStt ? browserRecorderDeps() : null;
  if (deps) return new RecorderController(deps);
  return new SpeechController(browserRecognitionCtor(), undefined, !isAppleMobile());
}

const Ctx = createContext<EngineController | null>(null);

/**
 * One speech engine for the whole app, so the center button and the Add screen
 * share a session. Prefers recording + server transcription when configured.
 */
export function SpeechProvider({ children }: { children: ReactNode }) {
  const [controller, setController] = useState<EngineController>(() => {
    let cached = false;
    try {
      cached = localStorage.getItem(SERVER_STT_KEY) === "1";
    } catch {}
    return makeController(cached);
  });

  useEffect(() => {
    let alive = true;
    fetch("/api/status")
      .then((r) => r.json())
      .then((s: { transcription?: string | null }) => {
        if (!alive) return;
        const server = Boolean(s.transcription);
        try {
          localStorage.setItem(SERVER_STT_KEY, server ? "1" : "0");
        } catch {}
        const wantServer = server && browserRecorderDeps() !== null;
        setController((c) => (c.engine === (wantServer ? "server" : "browser") || c.getSnapshot().status !== "idle" ? c : makeController(server)));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => () => controller.cancel(), [controller]);
  return <Ctx.Provider value={controller}>{children}</Ctx.Provider>;
}

export function useSpeech() {
  const c = useContext(Ctx);
  if (!c) throw new Error("SpeechProvider missing");
  const snap = useSyncExternalStore(c.subscribe, c.getSnapshot, c.getSnapshot);
  const recording = snap.status === "starting" || snap.status === "recording";
  return {
    ...snap,
    recording,
    supported: c.supported,
    start: () => c.start(),
    stop: () => c.stop(),
    cancel: () => c.cancel(),
    take: () => c.take(),
    retry: () => c.retry(),
    clearError: () => c.clearError(),
  };
}

/** Seconds since recording started, ticking while recording. */
export function useElapsed(startedAt: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [active]);
  return active ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
}
