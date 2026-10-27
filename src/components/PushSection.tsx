"use client";

import { useEffect, useState } from "react";
import { disablePush, enablePush, pushAvailability, pushEnabledHere, testPush, type PushAvailability } from "@/lib/client/push";
import { useSync } from "@/lib/client/sync";
import { Button, Notice } from "./ui";

/** "Reminders even when the app is closed" — explains each blocker instead of failing silently. */
export function PushSection() {
  const sync = useSync();
  const [avail, setAvail] = useState<PushAvailability>("unsupported");
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "info" | "warn" | "danger"; text: string } | null>(null);

  useEffect(() => {
    setAvail(pushAvailability());
    setOn(pushEnabledHere());
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      setMsg({
        tone: "danger",
        text: m === "permission" ? "לא ניתנה הרשאה להתראות. אפשר לאשר בהגדרות המכשיר." : m === "no_subscription" ? "המכשיר לא רשום לקבלת התראות. כבו והפעילו שוב." : "הפעולה נכשלה — בדקו את החיבור ונסו שוב.",
      });
    } finally {
      setBusy(false);
      setAvail(pushAvailability());
    }
  };

  return (
    <div className="grid gap-2 rounded-xl border border-line p-3">
      <div className="flex items-start justify-between gap-3">
        <span>
          <span className="block font-medium">התראות גם כשהאפליקציה סגורה</span>
          <span className="block text-sm text-muted">התזכורות נשלחות מהשרת לטלפון, בזמן, גם כשלא פתחתם את האפליקציה.</span>
        </span>
        {sync.linked && avail === "ok" && (
          <input
            type="checkbox"
            role="switch"
            aria-label="התראות גם כשהאפליקציה סגורה"
            className="mt-1 h-6 w-6 shrink-0 accent-[var(--color-accent)]"
            checked={on}
            disabled={busy}
            onChange={(e) =>
              void run(async () => {
                if (e.target.checked) {
                  await enablePush(sync.token!);
                  setOn(true);
                  setMsg({ tone: "info", text: "מופעל. אפשר לשלוח התראת בדיקה כדי לוודא." });
                } else {
                  await disablePush(sync.token);
                  setOn(false);
                }
              })
            }
          />
        )}
      </div>

      {!sync.linked ? (
        <p className="text-sm text-warn">צריך קודם להפעיל סנכרון (למטה בעמוד) — השרת שולח את התזכורות לפי הנתונים המסונכרנים.</p>
      ) : avail === "ios-needs-install" ? (
        <div className="rounded-xl bg-warn-soft p-3 text-[0.95rem] text-warn">
          <p className="font-medium">באייפון זה עובד רק מהאפליקציה שעל מסך הבית:</p>
          <ol className="mt-1 list-decimal space-y-0.5 ps-5">
            <li>בספארי לוחצים על כפתור השיתוף (הריבוע עם החץ).</li>
            <li>בוחרים <strong>הוספה למסך הבית</strong>.</li>
            <li>פותחים את ״ראש שקט״ מהמסך הבית, מחברים אותו לסנכרון ומפעילים כאן.</li>
          </ol>
        </div>
      ) : avail === "denied" ? (
        <p className="text-sm text-warn">ההתראות חסומות למכשיר הזה. מאשרים בהגדרות המכשיר ← התראות, ואז חוזרים לכאן.</p>
      ) : avail === "unsupported" ? (
        <p className="text-sm text-muted">הדפדפן הזה לא תומך בהתראות כשהאפליקציה סגורה.</p>
      ) : (
        on && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const n = await testPush(sync.token!);
                setMsg({ tone: "info", text: n ? "נשלחה התראת בדיקה דרך השרת — היא אמורה להופיע תוך כמה שניות, גם אם תסגרו את האפליקציה." : "לא נשלחה התראה. כבו והפעילו שוב." });
              })
            }
          >
            שליחת התראת בדיקה דרך השרת
          </Button>
        )
      )}
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
    </div>
  );
}
