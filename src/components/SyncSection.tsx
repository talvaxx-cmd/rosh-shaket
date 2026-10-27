"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSync, type DeviceInfo } from "@/lib/client/sync";
import { formatYmdHe, toHm, toYmd } from "@/lib/time";
import { Button, Card, Icon, Notice } from "./ui";

function ago(iso: string | null, tz: string): string {
  if (!iso) return "עוד לא";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "עכשיו";
  if (mins < 60) return `לפני ${mins} דק׳`;
  const d = new Date(iso);
  return `${formatYmdHe(toYmd(d, tz), { withWeekday: false })}, ${toHm(d, tz)}`;
}

const STATUS_TEXT = {
  off: "כבוי",
  idle: "מסונכרן",
  syncing: "מסנכרן…",
  offline: "אין חיבור — השינויים יישלחו כשהרשת תחזור",
  error: "שגיאה",
} as const;

export function SyncSection({ available, timeZone }: { available: boolean | null; timeZone: string }) {
  const sync = useSync();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<string | null>(null);
  const [pair, setPair] = useState<{ code: string; expiresAt: string } | null>(null);
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!sync.linked) return;
    sync.devices().then(setDevices).catch(() => setDevices(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync.linked, pair]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      setErr(code === "rate_limited" ? "יותר מדי ניסיונות. נסו שוב בעוד כמה דקות." : code === "not_configured" ? "הסנכרון עוד לא הופעל בשרת." : "הפעולה נכשלה — בדקו את החיבור ונסו שוב.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  if (available === false) {
    return (
      <Card>
        <p className="font-medium">הסנכרון עוד לא הופעל בשרת</p>
        <p className="mt-1 text-sm text-muted">כרגע הנתונים נשמרים רק במכשיר הזה. כדי להפעיל: מוסיפים מסד נתונים Postgres לפרויקט ב־Railway.</p>
      </Card>
    );
  }

  if (recovery) {
    return (
      <Card className="grid gap-3 border-accent">
        <p className="font-bold">הסנכרון פועל ✓</p>
        <p>
          זה <strong>קוד השחזור</strong> שלך. אם כל המכשירים יאבדו, איתו מחזירים את הנתונים. כדאי לשמור אותו במקום בטוח (למשל במנהל הסיסמאות). הוא לא יוצג שוב.
        </p>
        <p className="rounded-xl bg-sunken px-3 py-3 text-center text-lg font-bold tracking-wider ltr-nums" dir="ltr">
          {recovery}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => copy(recovery)}>{copied ? "הועתק ✓" : "העתקה"}</Button>
          <Button variant="primary" onClick={() => setRecovery(null)}>
            שמרתי
          </Button>
        </div>
      </Card>
    );
  }

  if (!sync.linked) {
    return (
      <Card className="grid gap-3">
        <p className="text-[0.95rem] text-muted">
          כרגע הכול נשמר רק במכשיר הזה. עם סנכרון, אותם אירועים ומשימות יופיעו בטלפון, במחשב ובכל מכשיר שתחברו — וגם יישמרו אם המכשיר יאבד.
        </p>
        {sync.error && <Notice tone="warn">{sync.error}</Notice>}
        {err && <Notice tone="danger">{err}</Notice>}
        <Button variant="primary" disabled={busy || available === null} onClick={() => run(async () => setRecovery(await sync.enable()))}>
          <Icon.Replan size={20} /> הפעלת סנכרון
        </Button>
        <Link href="/link" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-line bg-surface font-medium hover:bg-sunken">
          כבר יש לי סנכרון במכשיר אחר — חיבור
        </Link>
      </Card>
    );
  }

  return (
    <Card className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-medium">
          <span className={`h-2.5 w-2.5 rounded-full ${sync.status === "error" ? "bg-danger" : sync.status === "offline" ? "bg-warn" : "bg-accent"}`} aria-hidden />
          {STATUS_TEXT[sync.status]}
        </span>
        <button type="button" className="min-h-10 rounded-xl px-3 text-sm font-medium text-accent-strong hover:bg-accent-soft" onClick={() => void sync.syncNow()}>
          סנכרון עכשיו
        </button>
      </div>
      <p className="-mt-2 text-sm text-muted">
        סנכרון אחרון: {ago(sync.lastSyncAt, timeZone)}
        {sync.pending > 0 && ` · ${sync.pending} שינויים ממתינים`}
      </p>
      {sync.error && <Notice tone="warn">{sync.error}</Notice>}
      {err && <Notice tone="danger">{err}</Notice>}

      {pair ? (
        <div className="rounded-xl bg-accent-soft p-3">
          <p className="font-medium">במכשיר השני: הגדרות ← סנכרון ← חיבור, ומזינים:</p>
          <p className="my-2 text-center text-2xl font-bold tracking-widest ltr-nums" dir="ltr">
            {pair.code}
          </p>
          <p className="text-sm text-muted">
            או פותחים בו את הקישור. הקוד תקף ל־10 דקות ולשימוש אחד.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button size="sm" onClick={() => copy(`${location.origin}/link?code=${pair.code}`)}>
              {copied ? "הועתק ✓" : "העתקת קישור"}
            </Button>
            <Button size="sm" onClick={() => setPair(null)}>
              סגירה
            </Button>
          </div>
        </div>
      ) : (
        <Button disabled={busy} onClick={() => run(async () => setPair(await sync.pairingCode()))}>
          <Icon.Plus size={20} /> חיבור מכשיר נוסף
        </Button>
      )}

      {devices && devices.length > 0 && (
        <div>
          <p className="mb-1 text-sm font-medium text-muted">מכשירים מחוברים</p>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 px-3 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {d.name}
                    {d.current && <span className="text-sm font-normal text-muted"> · המכשיר הזה</span>}
                  </span>
                  <span className="block text-sm text-muted">פעיל {ago(d.lastSeen, timeZone)}</span>
                </span>
                <button
                  type="button"
                  className="min-h-10 shrink-0 rounded-xl px-3 text-sm font-medium text-danger hover:bg-danger-soft"
                  onClick={() => {
                    if (!confirm(d.current ? "לנתק את המכשיר הזה מהסנכרון? הנתונים יישארו בו." : `לנתק את ״${d.name}״?`)) return;
                    void run(async () => {
                      await sync.removeDevice(d.id, d.current);
                      if (!d.current) setDevices(await sync.devices());
                    });
                  }}
                >
                  ניתוק
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
