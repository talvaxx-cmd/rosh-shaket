"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { DraftCard } from "@/components/DraftCard";
import { Button, Icon, Notice, PageHeader, cx } from "@/components/ui";
import { newId } from "@/lib/domain/store-core";
import { emptyDraft, type DraftItem, type ExtractResponse } from "@/lib/extraction/draft";
import { autoResolve, draftConflicts, draftsToOp, isReady } from "@/lib/extraction/validate";
import { MicPermissionTip } from "@/components/MicPermissionTip";
import { SPEECH_ERROR_TEXT, useElapsed, useSpeech } from "@/lib/client/speech";
import { notificationPermission, requestNotificationPermission } from "@/lib/client/notifications";
import { useActions, useAppState } from "@/lib/client/store";
import { isYmd, relativeDayHe, toYmd } from "@/lib/time";

const DRAFT_KEY = "rosh-shaket:draft";

/** Tells the user where a saved item went, so nothing seems to disappear. */
function savedMessage(list: DraftItem[], today: string): string {
  const where = (d: DraftItem) => {
    if (d.kind === "event") return `${d.date ? relativeDayHe(d.date, today) : ""}${d.time ? ` ב־${d.time}` : ""}, ביומן`;
    if (d.kind === "task") return !d.date ? "ביומן של היום (בלי תאריך)" : `ביומן, ${relativeDayHe(d.date, today)}${d.time ? ` עד ${d.time}` : ""}`;
    return "ב״דורש טיפול״";
  };
  if (list.length === 1) return `נשמר ״${list[0]!.title}״ — ${where(list[0]!)}`;
  return `נשמרו ${list.length} פריטים: ${list.map((d) => `״${d.title}״`).join(", ")}`;
}
const SAMPLE = "מחר בשלוש פגישה עם דני במשרד, שעה בערך. תזכיר לי חצי שעה לפני, ותוסיף להכין את ההצעה בבוקר.";

type Phase = "input" | "extracting" | "review";

/** Live microphone level, so it's visible that the app is hearing you. */
function LevelBars({ level }: { level: number }) {
  const weights = [0.5, 0.8, 1, 0.8, 0.5];
  return (
    <span className="flex h-8 items-center gap-1" aria-hidden>
      {weights.map((w, i) => (
        <span
          key={i}
          className="w-1.5 rounded-full bg-accent transition-[height] duration-100"
          style={{ height: `${Math.max(15, Math.min(100, level * w * 140))}%` }}
        />
      ))}
    </span>
  );
}

function formatElapsed(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function AddInner() {
  const state = useAppState();
  const actions = useActions();
  const router = useRouter();
  const params = useSearchParams();
  const speech = useSpeech();
  const elapsed = useElapsed(speech.startedAt, speech.recording);
  const prefs = state.prefs;
  const tz = prefs.timeZone;

  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("input");
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [meta, setMeta] = useState<Pick<ExtractResponse, "mode" | "note" | "warning"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // One id per review session: a retried save can never create duplicates.
  const opId = useRef(newId("save"));
  const source = useRef<"voice" | "text" | "manual">("text");
  const [manual, setManual] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  /** Manual add: one empty card of the chosen kind, straight to review. */
  function startManual(kind: "event" | "task", date?: string | null) {
    const d = emptyDraft(newId("m"), kind, "");
    d.date = isYmd(date) ? date : kind === "event" ? toYmd(new Date(), tz) : null;
    if (kind === "event") d.durationMin = prefs.defaultEventMin;
    setDrafts([d]);
    setMeta(null);
    setManual(true);
    source.current = "manual";
    opId.current = newId("save");
    setPhase("review");
  }

  // Restore an unsaved draft (only if the user allowed local drafts).
  useEffect(() => {
    const manualKind = params.get("manual");
    if (manualKind === "event" || manualKind === "task") {
      startManual(manualKind, params.get("date"));
      return;
    }
    const sample = params.get("sample");
    const prefill = params.get("text");
    if (sample || prefill) {
      setText(prefill ?? SAMPLE);
      return;
    }
    if (!prefs.saveDraftsLocally) return;
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) setText(saved);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!prefs.saveDraftsLocally) return;
    try {
      if (text) localStorage.setItem(DRAFT_KEY, text);
      else localStorage.removeItem(DRAFT_KEY);
    } catch {}
  }, [text, prefs.saveDraftsLocally]);

  // Recording finished (here or from the center button) → understand it right away.
  useEffect(() => {
    if (speech.status === "idle" && speech.text) {
      const heard = speech.take();
      // Each recording on its own line, so separate utterances stay separate items.
      const next = text ? `${text.trimEnd()}\n${heard}` : heard;
      setText(next);
      source.current = "voice";
      if (phase === "input") void extract(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speech.status, speech.text]);

  const clearDraft = () => {
    setText("");
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {}
  };

  async function extract(override?: string) {
    const input = (override ?? text).trim();
    if (!input) return;
    setPhase("extracting");
    setError(null);
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: input,
          ctx: {
            now: new Date().toISOString(),
            timeZone: tz,
            dayStart: prefs.dayStart,
            dayEnd: prefs.dayEnd,
            defaultEventMin: prefs.defaultEventMin,
            defaultTaskMin: prefs.defaultTaskMin,
          },
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as ExtractResponse;
      // Added from a specific day (e.g. "מחר" on the Today screen): undated items go to that day.
      const forDate = params.get("date");
      if (isYmd(forDate)) {
        data.items = data.items.map((d) =>
          d.date || d.kind === "unresolved" ? d : { ...d, date: forDate, uncertainties: d.uncertainties.filter((u) => u.field !== "date" && u.field !== "due") },
        );
      }
      opId.current = newId("save");
      // Clear items save straight away; anything unclear or overlapping goes to review.
      // Automatic mode: everything goes into the calendar right away. Unclear details are
      // guessed and marked "לבדוק"; nothing waits on a question, nothing is dropped.
      if (prefs.autoSave) {
        const ctx = { now: new Date().toISOString(), timeZone: tz, dayStart: prefs.dayStart, dayEnd: prefs.dayEnd, defaultEventMin: prefs.defaultEventMin, defaultTaskMin: prefs.defaultTaskMin };
        let items = data.items;
        if (!items.length) {
          const fallback = emptyDraft(newId("m"), "task", input);
          fallback.title = input.slice(0, 120);
          fallback.date = isYmd(forDate) ? forDate : null;
          fallback.unsure = "לא הבנתי בדיוק — נשמר כפי שנאמר";
          items = [fallback];
        }
        if (saveDrafts(autoResolve(items, ctx))) return;
      }
      setDrafts(data.items);
      setMeta({ mode: data.mode, note: data.note, warning: data.warning });
      setManual(false);
      setPhase("review");
    } catch {
      setError("לא הצלחתי לפענח כרגע — כנראה בעיית רשת. שום דבר לא נשמר. אפשר לנסות שוב או לערוך את הטקסט.");
      setPhase("input");
    }
  }

  const today = toYmd(new Date(), tz);
  const conflicts = useMemo(() => drafts.map((d) => draftConflicts(state, d, tz)), [drafts, state, tz]);
  const allReady = drafts.length > 0 && drafts.every(isReady);
  const pending = drafts.filter((d) => !isReady(d)).length;

  function save() {
    saveDrafts(drafts);
  }

  /** Saves and goes home; returns false (and shows why) if storage failed. */
  function saveDrafts(list: DraftItem[]): boolean {
    setSaveError(null);
    const op = draftsToOp(list, { opId: opId.current, timeZone: tz, now: new Date(), source: source.current, defaultTaskMin: prefs.defaultTaskMin });
    try {
      const applied = actions.dispatch(op);
      clearDraft();
      // Notification permission is asked only when a reminder is actually created.
      if (applied && op.put?.some((i) => i.kind === "reminder") && notificationPermission() === "default") {
        void requestNotificationPermission();
      }
      const guessed = op.put?.find((i) => (i.kind === "event" || i.kind === "task") && i.unsure);
      actions.toast({
        text: applied ? `${savedMessage(list, today)}${guessed ? " · כדאי לבדוק" : ""}` : "כבר נשמר",
        undoOpId: applied ? op.opId : undefined,
        link: applied && guessed ? { href: `/item/${guessed.id}`, label: "בדיקה" } : undefined,
      });
      router.push("/");
      return true;
    } catch {
      setSaveError("הפריטים לא נשמרו (האחסון במכשיר לא זמין או מלא). אפשר לנסות שוב — לא ייווצרו כפילויות.");
      return false;
    }
  }

  const recording = speech.recording;

  if (phase === "review") {
    return (
      <>
        <PageHeader
          title={manual ? (drafts[0]?.kind === "task" ? "משימה חדשה" : "אירוע חדש") : "בדיקה לפני שמירה"}
          subtitle={manual ? "ממלאים את הפרטים ושומרים" : drafts.length ? `${drafts.length === 1 ? "פריט אחד" : `${drafts.length} פריטים`} — אפשר לתקן, להסיר או לשמור` : undefined}
        />
        <div className="grid gap-3">
          {meta?.warning && <Notice tone="warn">{meta.warning}</Notice>}
          {meta?.mode === "rules" && !meta.warning && (
            <Notice>זוהה במנוע הבסיסי שבמכשיר. כדאי להעיף מבט על הפרטים.</Notice>
          )}
          {drafts.length === 0 && (
            <Notice tone="warn" title="לא זיהיתי מה לשמור">
              {meta?.note ?? "אפשר לנסח מחדש, למשל: ״מחר בעשר בבוקר תור לרופא״."}
            </Notice>
          )}
          {drafts.map((d, i) => (
            <DraftCard
              key={d.ref}
              draft={d}
              index={i}
              today={today}
              timeZone={tz}
              conflicts={conflicts[i] ?? []}
              prepTitle={d.prepForRef ? drafts.find((x) => x.ref === d.prepForRef)?.title : undefined}
              onChange={(nd) => setDrafts((ds) => ds.map((x, j) => (j === i ? nd : x)))}
              onRemove={() => setDrafts((ds) => ds.filter((_, j) => j !== i).map((x) => (x.prepForRef === d.ref ? { ...x, prepForRef: null } : x)))}
            />
          ))}
          {saveError && <Notice tone="danger">{saveError}</Notice>}
        </div>

        <div className="sticky bottom-24 z-30 mt-5 flex flex-col gap-2 rounded-3xl border border-line bg-surface/95 p-3 shadow-lg backdrop-blur">
          {pending > 0 && (
            <p className="px-2 text-sm text-warn">
              {pending === 1 ? "כרטיס אחד מחכה להבהרה" : `${pending} כרטיסים מחכים להבהרה`} — המסומנים בכתום
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="primary" size="lg" className="flex-1" disabled={!allReady} onClick={save}>
              <Icon.Check />
              {saveError ? "ניסיון חוזר" : drafts.length > 1 ? `שמירת ${drafts.length} פריטים` : "שמירה"}
            </Button>
            <Button size="lg" onClick={() => (manual ? router.back() : setPhase("input"))}>
              {manual ? "ביטול" : "חזרה לטקסט"}
            </Button>
          </div>
          <button
            type="button"
            className="min-h-10 text-sm text-muted underline-offset-4 hover:underline"
            onClick={() => {
              setDrafts([]);
              clearDraft();
              router.push("/");
            }}
          >
            ביטול — לא לשמור כלום
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="הוספת משימה או אירוע"
        subtitle={
          isYmd(params.get("date")) ? (
            <>
              מוסיפים ל<strong className="font-medium text-ink">{relativeDayHe(params.get("date")!, today)}</strong> — אלא אם תגידו יום אחר.
            </>
          ) : (
            "אומרים בחופשיות — אפשר כמה דברים ברצף. או מקלידים, או מוסיפים ידנית."
          )
        }
      />

      <div className="flex flex-col items-center gap-3 py-4">
        {speech.supported ? (
          <>
            <button
              type="button"
              onClick={recording ? speech.stop : speech.start}
              disabled={speech.status === "stopping" || speech.status === "transcribing"}
              aria-pressed={recording}
              aria-label={recording ? "עצירת ההקלטה" : "התחלת הקלטה"}
              className={cx(
                "flex h-32 w-32 touch-manipulation select-none items-center justify-center rounded-full text-on-accent shadow-xl transition-colors",
                recording ? "recording-pulse bg-accent-strong" : "bg-accent hover:bg-accent-strong",
              )}
            >
              {recording ? <Icon.Stop size={40} /> : <Icon.Mic size={44} />}
            </button>
            <div className="min-h-7 text-center" aria-live="polite">
              {recording ? (
                <span className="flex items-center gap-2 font-medium text-accent-strong">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-danger" aria-hidden />
                  מקליט <span className="ltr-nums">{formatElapsed(elapsed)}</span>
                </span>
              ) : speech.status === "stopping" || speech.status === "transcribing" ? (
                <span className="flex items-center gap-2 font-medium text-accent-strong">
                  <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" aria-hidden />
                  מתמלל…
                </span>
              ) : (
                <span className="text-muted">הקשה אחת כדי לדבר, הקשה נוספת לסיום</span>
              )}
            </div>
            {recording && (
              <Button size="sm" variant="ghost" onClick={speech.cancel}>
                ביטול הקלטה
              </Button>
            )}
          </>
        ) : (
          <Notice>{SPEECH_ERROR_TEXT.unsupported}</Notice>
        )}
        {speech.error && (
          <Notice tone="warn">
            {SPEECH_ERROR_TEXT[speech.error]}
            {speech.canRetry && (
              <div className="mt-2">
                <Button size="sm" variant="primary" onClick={speech.retry}>
                  לנסות שוב לתמלל
                </Button>
              </div>
            )}
          </Notice>
        )}
        {speech.supported && <MicPermissionTip forceOpen={speech.error === "not-allowed"} />}
      </div>

      {recording && speech.engine === "server" && (
        <div className="mb-3 flex min-h-14 items-center gap-3 rounded-2xl bg-sunken px-4 py-3" aria-live="polite">
          <LevelBars level={speech.level} />
          <span className="text-muted">מקשיב — מדברים בחופשיות, הטקסט יופיע כשתסיימו</span>
        </div>
      )}

      {(recording || speech.status === "stopping") && speech.engine === "browser" && (
        <p className="mb-3 min-h-14 rounded-2xl bg-sunken px-4 py-3 text-lg" aria-live="polite">
          {speech.text || speech.interim ? (
            <>
              {speech.text} <span className="text-faint">{speech.interim}</span>
            </>
          ) : (
            <span className="text-faint">מקשיב…</span>
          )}
        </p>
      )}

      <label htmlFor="capture-text" className="mb-1 flex items-center gap-1.5 text-sm font-medium text-muted">
        <Icon.Keyboard size={18} /> {text ? "התמלול — אפשר לתקן לפני שממשיכים" : "או להקליד"}
      </label>
      <textarea
        id="capture-text"
        ref={textRef}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (speech.status === "idle" && !text) source.current = "text";
        }}
        rows={4}
        placeholder="למשל: מחר בעשר בבוקר תור לרופא, ולקנות מתנה לנועה עד יום חמישי"
        className="w-full resize-y rounded-2xl border border-line bg-surface p-4 text-lg leading-relaxed placeholder:text-faint focus:border-accent focus:outline-none"
      />

      {error && (
        <div className="mt-3">
          <Notice tone="danger">{error}</Notice>
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <Button variant="primary" size="lg" className="flex-1" disabled={!text.trim() || phase === "extracting" || recording} onClick={() => void extract()}>
          {phase === "extracting" ? "מפענח…" : error ? "ניסיון חוזר" : prefs.autoSave ? "שמירה" : "המשך לבדיקה"}
        </Button>
        {text && (
          <Button size="lg" onClick={clearDraft} disabled={phase === "extracting"}>
            ניקוי
          </Button>
        )}
      </div>
      {!text && (
        <button type="button" className="mt-4 text-sm text-accent-strong underline underline-offset-4" onClick={() => setText(SAMPLE)}>
          לנסות עם משפט לדוגמה
        </button>
      )}
      <div className="mt-6 rounded-2xl border border-line bg-surface p-3">
        <p className="mb-2 text-sm font-medium text-muted">או הוספה ידנית, בלי לדבר</p>
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => startManual("event", params.get("date"))}>
            <Icon.Clock size={18} /> אירוע בשעה קבועה
          </Button>
          <Button onClick={() => startManual("task", params.get("date"))}>
            <Icon.Check size={18} /> משימה
          </Button>
        </div>
      </div>
      <p className="mt-6 text-sm text-faint">
        שום דבר לא נשמר לפני שתאשרו. ההקלטה עצמה לא נשמרת. <Link href="/settings#privacy" className="underline underline-offset-4">פרטיות</Link>
      </p>
    </>
  );
}

export default function AddPage() {
  return (
    <Suspense>
      <AddInner />
    </Suspense>
  );
}
