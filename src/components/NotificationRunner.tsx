"use client";

import { useEffect, useRef } from "react";
import { agendaForDay, overdueTasks } from "@/lib/domain/agenda";
import { dueNotifications, markShownOp, snoozeOp, isQuiet } from "@/lib/domain/reminders";
import { completeTaskOp, newId, touch } from "@/lib/domain/store-core";
import type { AppState, Reminder, Task } from "@/lib/domain/types";
import { registerServiceWorker, showNotification } from "@/lib/client/notifications";
import { useActions, useAppState } from "@/lib/client/store";
import { toHm, toYmd } from "@/lib/time";

const CHECK_EVERY_MS = 20_000;
const SUMMARY_KEY = "rosh-shaket:last-summary";

/**
 * Shows due reminders while the app is open. Only one tab does this at a time
 * (Web Locks), and each occurrence has a stable tag, so the OS replaces rather
 * than duplicates a notification.
 */
export function NotificationRunner() {
  const state = useAppState();
  const actions = useActions();
  const stateRef = useRef<AppState>(state);
  stateRef.current = state;

  useEffect(() => {
    void registerServiceWorker();
  }, []);

  // Actions pressed on a notification (handled by the service worker, relayed here).
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      const msg = e.data as { type?: string; action?: string; reminderId?: string };
      if (msg?.type !== "notification-action" || !msg.reminderId) return;
      const s = stateRef.current;
      const r = s.items[msg.reminderId] as Reminder | undefined;
      if (!r || r.kind !== "reminder") return;
      const now = new Date();
      if (msg.action === "snooze") {
        actions.dispatch(snoozeOp(r, 10, now, newId("op")));
        actions.toast({ text: "התזכורת נדחתה ב־10 דקות. מועד האירוע לא השתנה." });
      } else if (msg.action === "done") {
        const target = s.items[r.target.id];
        if (target?.kind === "task") actions.run(completeTaskOp(target as Task, true, newId("op"), now));
        else actions.dispatch({ opId: newId("op"), label: "תזכורת סומנה", source: "manual", put: [touch(r, now, { lastOpenedAt: now.toISOString() })] });
      } else {
        actions.dispatch({ opId: newId("op"), label: "תזכורת נפתחה", source: "system", put: [touch(r, now, { lastOpenedAt: now.toISOString() })] });
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [actions]);

  useEffect(() => {
    let stopped = false;
    let release: (() => void) | null = null;

    const tick = async () => {
      const s = stateRef.current;
      const now = new Date();
      const due = dueNotifications(s, now);
      if (due.length) {
        // Merge bursts into one notification to avoid flooding.
        if (due.length > 2) {
          await showNotification({
            title: s.prefs.hideNotificationContent ? "ראש שקט" : `${due.length} תזכורות`,
            body: s.prefs.hideNotificationContent ? "יש לך תזכורות" : due.map((d) => d.title).join(" · "),
            tag: `batch:${now.toISOString().slice(0, 16)}`,
            url: "/",
          });
        } else {
          for (const d of due) {
            await showNotification({ title: d.title, body: d.body, tag: d.tag, url: d.url, reminderId: d.reminderId, actions: true });
          }
        }
        actions.dispatch(markShownOp(s, due.map((d) => d.reminderId), now, newId("op")));
      }

      // Optional daily summary, once a day, outside quiet hours.
      if (s.prefs.dailySummary && !isQuiet(now, s.prefs)) {
        const tz = s.prefs.timeZone;
        const today = toYmd(now, tz);
        let last: string | null = null;
        try {
          last = localStorage.getItem(SUMMARY_KEY);
        } catch {}
        if (last !== today && toHm(now, tz) >= s.prefs.dailySummaryAt) {
          const agenda = agendaForDay(s, today, tz);
          const ev = agenda.filter((a) => a.type === "event").length;
          const tk = agenda.filter((a) => a.type === "task").length;
          const late = overdueTasks(s, now).length;
          await showNotification({
            title: "סיכום היום",
            body: `${ev} אירועים · ${tk} משימות משובצות${late ? ` · ${late} באיחור` : ""}`,
            tag: `summary:${today}`,
            url: "/",
          });
          try {
            localStorage.setItem(SUMMARY_KEY, today);
          } catch {}
        }
      }
    };

    const loop = async () => {
      while (!stopped) {
        try {
          await tick();
        } catch {
          // A failed check must not stop future checks.
        }
        await new Promise((r) => setTimeout(r, CHECK_EVERY_MS));
      }
    };

    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    if (locks) {
      void locks.request("rosh-shaket:notifier", () => new Promise<void>((resolve) => {
        release = resolve;
        void loop();
      }));
    } else {
      void loop();
    }
    return () => {
      stopped = true;
      release?.();
    };
  }, [actions]);

  return null;
}
