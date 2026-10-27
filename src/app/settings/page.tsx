"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Card, Field, Icon, Notice, PageHeader, SectionTitle, inputClass } from "@/components/ui";
import { PushSection } from "@/components/PushSection";
import { SyncSection } from "@/components/SyncSection";
import { emptyState } from "@/lib/domain/store-core";
import type { Preferences } from "@/lib/domain/types";
import { notificationPermission, requestNotificationPermission, showNotification, type PermissionState } from "@/lib/client/notifications";
import { useActions, useAppState } from "@/lib/client/store";
import { defaultTimeZone } from "@/lib/time";

function Toggle({ id, label, hint, checked, onChange }: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start justify-between gap-4 py-1">
      <span>
        <span className="block font-medium">{label}</span>
        {hint && <span className="block text-sm text-muted">{hint}</span>}
      </span>
      <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-6 w-6 shrink-0 accent-[var(--color-accent)]" />
    </label>
  );
}

const PERMISSION_TEXT: Record<PermissionState, string> = {
  granted: "מאושרות",
  denied: "חסומות — אפשר לאשר מחדש בהגדרות הדפדפן",
  default: "טרם אושרו",
  unsupported: "הדפדפן לא תומך בהתראות",
};

export default function SettingsPage() {
  const state = useAppState();
  const actions = useActions();
  const p = state.prefs;
  const set = (patch: Partial<Preferences>) => actions.setPrefs(patch);
  const [perm, setPerm] = useState<PermissionState>("default");
  const [status, setStatus] = useState<{ extraction: "ai" | "rules"; model: string | null; transcription: "openai" | "elevenlabs" | null; version?: string | null; sync?: boolean } | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);

  useEffect(() => {
    setPerm(notificationPermission());
    fetch("/api/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  const zones = [...new Set([defaultTimeZone(), p.timeZone, "Asia/Jerusalem", "Europe/London", "America/New_York"])];

  const exportData = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rosh-shaket-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const testNotification = async () => {
    let current = perm;
    if (current === "default") {
      current = await requestNotificationPermission();
      setPerm(current);
    }
    const ok = await showNotification({ title: "בדיקת התראה", body: "אם רואים את זה — ההתראות עובדות.", tag: "test", url: "/settings" });
    setTestResult(ok ? "ההתראה נמסרה למערכת. אם לא הופיעה — בדקו את מצב ״נא לא להפריע״ והגדרות ההתראות של המכשיר." : "לא ניתן היה להציג התראה. " + PERMISSION_TEXT[current]);
  };

  return (
    <>
      <PageHeader title="הגדרות" />

      {!actions.persistent && (
        <Notice tone="danger" title="האחסון במכשיר חסום">
          הנתונים לא יישמרו אחרי סגירת הדפדפן (למשל במצב גלישה פרטית).
        </Notice>
      )}

      <SectionTitle>היום שלי</SectionTitle>
      <Card className="grid gap-4">
        <Field label="אזור זמן" htmlFor="tz" hint="שינוי כאן לא מזיז אירועים שכבר נקבעו — הם נשמרים כמועד מוחלט.">
          <select id="tz" className={inputClass} value={p.timeZone} onChange={(e) => set({ timeZone: e.target.value })}>
            {zones.map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="תחילת היום" htmlFor="ds">
            <input id="ds" type="time" className={`${inputClass} ltr-nums`} value={p.dayStart} onChange={(e) => set({ dayStart: e.target.value })} />
          </Field>
          <Field label="סוף היום" htmlFor="de">
            <input id="de" type="time" className={`${inputClass} ltr-nums`} value={p.dayEnd} onChange={(e) => set({ dayEnd: e.target.value })} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="מרווח בין התחייבויות (דק׳)" htmlFor="buf">
            <input id="buf" type="number" min={0} max={60} step={5} className={`${inputClass} ltr-nums`} value={p.bufferMin} onChange={(e) => set({ bufferMin: Math.max(0, Number(e.target.value) || 0) })} />
          </Field>
          <Field label="שעות ריכוז מועדפות" htmlFor="focus">
            <select id="focus" className={inputClass} value={p.focusWindow ?? ""} onChange={(e) => set({ focusWindow: (e.target.value || undefined) as Preferences["focusWindow"] })}>
              <option value="">אין העדפה</option>
              <option value="morning">בוקר</option>
              <option value="afternoon">צהריים</option>
              <option value="evening">ערב</option>
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="משך פגישה כשלא נאמר (דק׳)" htmlFor="dem">
            <input id="dem" type="number" min={5} step={5} className={`${inputClass} ltr-nums`} value={p.defaultEventMin} onChange={(e) => set({ defaultEventMin: Math.max(5, Number(e.target.value) || 60) })} />
          </Field>
          <Field label="משך משימה משוער (דק׳)" htmlFor="dtm">
            <input id="dtm" type="number" min={5} step={5} className={`${inputClass} ltr-nums`} value={p.defaultTaskMin} onChange={(e) => set({ defaultTaskMin: Math.max(5, Number(e.target.value) || 30) })} />
          </Field>
        </div>
      </Card>

      <SectionTitle>
        <span id="sync">סנכרון בין מכשירים</span>
      </SectionTitle>
      <SyncSection available={status ? Boolean(status.sync) : null} timeZone={p.timeZone} />

      <SectionTitle>הוספה</SectionTitle>
      <Card>
        <Toggle
          id="autosave"
          label="שמירה אוטומטית כשהכול ברור"
          hint="אחרי דיבור או הקלדה, פריטים ברורים נשמרים מיד (עם כפתור ביטול). כרטיס לבדיקה יופיע רק כשמשהו לא ברור או חופף."
          checked={p.autoSave}
          onChange={(v) => set({ autoSave: v })}
        />
      </Card>

      <SectionTitle>התראות</SectionTitle>
      <Card className="grid gap-3">
        <p>
          מצב ההרשאה: <strong>{PERMISSION_TEXT[perm]}</strong>
        </p>
        <div className="flex flex-wrap gap-2">
          {perm === "default" && (
            <Button variant="primary" onClick={async () => setPerm(await requestNotificationPermission())}>
              <Icon.Bell size={20} /> אישור התראות
            </Button>
          )}
          <Button onClick={testNotification} disabled={perm === "unsupported" || perm === "denied"}>
            בדיקת התראה
          </Button>
        </div>
        {testResult && <Notice>{testResult}</Notice>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="שעות שקטות מ־" htmlFor="qs">
            <input id="qs" type="time" className={`${inputClass} ltr-nums`} value={p.quietStart} onChange={(e) => set({ quietStart: e.target.value })} />
          </Field>
          <Field label="עד" htmlFor="qe">
            <input id="qe" type="time" className={`${inputClass} ltr-nums`} value={p.quietEnd} onChange={(e) => set({ quietEnd: e.target.value })} />
          </Field>
        </div>
        <Toggle id="hide" label="הסתרת התוכן במסך הנעילה" hint="ההתראה תציג רק ״יש לך תזכורת״." checked={p.hideNotificationContent} onChange={(v) => set({ hideNotificationContent: v })} />
        <Toggle id="sum" label="סיכום יומי" hint="התראה אחת בבוקר עם מה שמחכה היום." checked={p.dailySummary} onChange={(v) => set({ dailySummary: v })} />
        {p.dailySummary && (
          <Field label="שעת הסיכום" htmlFor="sumat">
            <input id="sumat" type="time" className={`${inputClass} ltr-nums`} value={p.dailySummaryAt} onChange={(e) => set({ dailySummaryAt: e.target.value })} />
          </Field>
        )}
        <PushSection />
        <p className="text-sm text-muted">
          בלי ״התראות גם כשהאפליקציה סגורה״, תזכורות מוצגות רק כשהאפליקציה פתוחה או פעילה ברקע. בכל מקרה האפליקציה יודעת שהתראה נשלחה — לא שהיא נראתה.
        </p>
      </Card>

      <SectionTitle>זיהוי דיבור ושפה</SectionTitle>
      <Card className="grid gap-2">
        <p>
          תמלול:{" "}
          <strong>
            {status == null
              ? "בבדיקה…"
              : status.transcription === "openai"
                ? "הקלטה ותמלול בשרת (OpenAI)"
                : status.transcription === "elevenlabs"
                  ? "הקלטה ותמלול בשרת (ElevenLabs)"
                  : "מנוע הדיבור של הדפדפן"}
          </strong>
        </p>
        <p>
          הבנת המשפטים:{" "}
          <strong>{status == null ? "בבדיקה…" : status.extraction === "ai" ? `Claude (${status.model})` : "מנוע בסיסי במכשיר/בשרת, ללא בינה מלאכותית"}</strong>
        </p>
        <p className="text-sm text-muted">רכיב השפה רק מציע. כל פריט עובר בדיקת כללים ואישור שלכם לפני שנשמר.</p>
      </Card>

      <SectionTitle>חיבורים</SectionTitle>
      <Card>
        <div className="flex items-center justify-between gap-3">
          <span>
            <span className="block font-medium">יומן Google</span>
            <span className="block text-sm text-muted">יגיע אחרי בדיקת היתכנות. האפליקציה שימושית גם בלעדיו.</span>
          </span>
          <Button size="sm" disabled>
            בקרוב
          </Button>
        </div>
      </Card>

      <SectionTitle>
        <span id="privacy">פרטיות ונתונים</span>
      </SectionTitle>
      <Card className="grid gap-3">
        <ul className="grid list-disc gap-1 ps-5 text-[0.98rem]">
          <li>המיקרופון נפתח רק כשמקישים עליו. אין הקלטה ברקע.</li>
          <li>
            {status?.transcription
              ? `ההקלטה נשלחת לתמלול ל־${status.transcription === "openai" ? "OpenAI" : "ElevenLabs"} ואינה נשמרת אצלנו; המיקרופון נסגר מיד בסיום ההקלטה.`
              : "ההקלטה עצמה לא נשמרת. התמלול נעשה על ידי שירות הדיבור של הדפדפן (בכרום — Google, באייפון — Apple)."}
          </li>
          <li>הטקסט נשלח לפענוח{status?.extraction === "ai" ? " ל־Claude של Anthropic" : ""} ולא נשמר בשרת שלנו. תוכן אישי לא נכתב ללוגים.</li>
          <li>
            {status?.sync
              ? "הפריטים נשמרים במכשיר. אם הפעלתם סנכרון, עותק נשמר גם בשרת של האפליקציה כדי שיגיע למכשירים שלכם — ורק אליהם."
              : "כל הפריטים נשמרים רק במכשיר הזה. אין חשבון ואין עותק בשרת."}
          </li>
        </ul>
        <Toggle
          id="drafts"
          label="שמירת טיוטה במכשיר"
          hint="טקסט שלא נשמר ייזכר עד שתשמרו או תנקו."
          checked={p.saveDraftsLocally}
          onChange={(v) => {
            set({ saveDraftsLocally: v });
            if (!v) {
              try {
                localStorage.removeItem("rosh-shaket:draft");
              } catch {}
            }
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button onClick={exportData}>ייצוא הנתונים (JSON)</Button>
          <Link href="/history" className="inline-flex min-h-12 items-center gap-2 rounded-full border border-line bg-surface px-5 font-medium hover:bg-sunken">
            <Icon.History size={20} /> היסטוריית שינויים
          </Link>
        </div>
        {!confirmWipe ? (
          <Button variant="danger" onClick={() => setConfirmWipe(true)}>
            מחיקת כל הנתונים
          </Button>
        ) : (
          <Notice tone="danger" title="למחוק הכול מהמכשיר?">
            <p>כל האירועים, המשימות, התזכורות וההיסטוריה יימחקו{status?.sync ? " — וגם בכל המכשירים המסונכרנים" : ""}. אי אפשר לבטל.</p>
            <div className="mt-2 flex gap-2">
              <Button
                variant="danger"
                onClick={() => {
                  actions.replaceAll(emptyState({ ...p }));
                  setConfirmWipe(false);
                  actions.toast({ text: "כל הנתונים נמחקו" });
                }}
              >
                כן, למחוק
              </Button>
              <Button onClick={() => setConfirmWipe(false)}>ביטול</Button>
            </div>
          </Notice>
        )}
      </Card>

      <p className="mt-8 text-center text-sm text-faint">
        ראש שקט · גרסה {status?.version ?? "מקומית"} ·{" "}
        <button type="button" className="underline underline-offset-4" onClick={() => set({ onboarded: false })}>
          הצגת ההיכרות מחדש
        </button>
      </p>
    </>
  );
}
