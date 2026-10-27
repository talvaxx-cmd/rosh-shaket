"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { SpeechController, browserRecognitionCtor, type SpeechError } from "./speech-controller";

export type { SpeechError, SpeechStatus } from "./speech-controller";

export const SPEECH_ERROR_TEXT: Record<SpeechError, string> = {
  "not-allowed": "אין הרשאה למיקרופון. אפשר לאשר בהגדרות הדפדפן, או להקליד.",
  "no-speech": "לא נשמע דיבור. נסו שוב או הקלידו.",
  network: "התמלול דורש חיבור לרשת. אפשר להקליד בינתיים.",
  "audio-capture": "לא נמצא מיקרופון פעיל.",
  unsupported: "הדפדפן הזה לא תומך בהקלטה. אפשר להקליד — זה עובד בדיוק אותו דבר.",
  other: "התמלול נכשל. נסו שוב או הקלידו.",
};

const Ctx = createContext<SpeechController | null>(null);

/** One recognizer for the whole app, so the center button and the Add screen share a session. */
export function SpeechProvider({ children }: { children: ReactNode }) {
  const [controller] = useState(() => new SpeechController(browserRecognitionCtor()));
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

/** iPhone / iPad Safari, where the site's microphone permission is set per website. */
export function isAppleMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
