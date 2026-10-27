"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Hebrew speech-to-text via the browser's Web Speech API.
 * The microphone is opened only after the user taps; nothing records in the background.
 * Note: in Chrome the audio is processed by the browser vendor's speech service.
 */

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

type Ctor = new () => SpeechRecognitionLike;

function getCtor(): Ctor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export type SpeechStatus = "idle" | "starting" | "recording" | "stopping";
export type SpeechError = "not-allowed" | "no-speech" | "network" | "audio-capture" | "unsupported" | "other";

export const SPEECH_ERROR_TEXT: Record<SpeechError, string> = {
  "not-allowed": "אין הרשאה למיקרופון. אפשר לאשר בהגדרות הדפדפן, או להקליד.",
  "no-speech": "לא נשמע דיבור. נסו שוב או הקלידו.",
  network: "התמלול דורש חיבור לרשת. אפשר להקליד בינתיים.",
  "audio-capture": "לא נמצא מיקרופון פעיל.",
  unsupported: "הדפדפן הזה לא תומך בהקלטה. אפשר להקליד — זה עובד בדיוק אותו דבר.",
  other: "התמלול נכשל. נסו שוב או הקלידו.",
};

export function useSpeech() {
  const [supported, setSupported] = useState(false);
  const [status, setStatus] = useState<SpeechStatus>("idle");
  const [finalText, setFinalText] = useState("");
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<SpeechError | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const rec = useRef<SpeechRecognitionLike | null>(null);
  const cancelled = useRef(false);
  const startedAt = useRef(0);

  useEffect(() => setSupported(getCtor() !== null), []);

  useEffect(() => {
    if (status !== "recording") return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 250);
    return () => clearInterval(t);
  }, [status]);

  const start = useCallback(() => {
    const C = getCtor();
    if (!C) {
      setError("unsupported");
      return;
    }
    setError(null);
    setFinalText("");
    setInterim("");
    setElapsed(0);
    cancelled.current = false;
    const r = new C();
    r.lang = "he-IL";
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onstart = () => {
      startedAt.current = Date.now();
      setStatus("recording");
    };
    r.onresult = (e) => {
      let fin = "";
      let mid = "";
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i]!;
        const text = res[0]?.transcript ?? "";
        if (res.isFinal) fin += text;
        else mid += text;
      }
      setFinalText(fin.trim());
      setInterim(mid.trim());
    };
    r.onerror = (e) => {
      if (e.error === "aborted") return;
      const known: SpeechError[] = ["not-allowed", "no-speech", "network", "audio-capture"];
      setError(e.error === "service-not-allowed" ? "not-allowed" : known.includes(e.error as SpeechError) ? (e.error as SpeechError) : "other");
    };
    r.onend = () => {
      setStatus("idle");
      setInterim((mid) => {
        if (mid && !cancelled.current) setFinalText((f) => `${f} ${mid}`.trim());
        return "";
      });
      if (cancelled.current) setFinalText("");
      rec.current = null;
    };
    rec.current = r;
    setStatus("starting");
    try {
      r.start();
    } catch {
      setStatus("idle");
      setError("other");
    }
  }, []);

  const stop = useCallback(() => {
    if (!rec.current) return;
    setStatus("stopping");
    rec.current.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelled.current = true;
    rec.current?.abort();
    setFinalText("");
    setInterim("");
    setStatus("idle");
  }, []);

  useEffect(() => () => rec.current?.abort(), []);

  return { supported, status, finalText, interim, error, elapsed, start, stop, cancel, setError };
}
