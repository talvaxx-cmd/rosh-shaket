import { addMinutes, hmToMinutes, toHm, toYmd, zonedToInstant, addDaysYmd, formatDurationHe } from "../time";
import { occurrencesInRange } from "./recurrence";
import { newId, touch, type Op } from "./store-core";
import type { AppState, CalendarEvent, Preferences, Reminder, Task } from "./types";

export interface DueNotification {
  reminderId: string;
  /** Unique per occurrence, used as the notification tag to avoid duplicates. */
  tag: string;
  fireAt: string;
  title: string;
  body: string;
  url: string;
  targetKind: "event" | "task";
  targetId: string;
}

/** How late a reminder may still be shown. Older ones are skipped, not replayed in a flood. */
const MAX_LATE_MS = 2 * 60 * 60 * 1000;

export function isQuiet(at: Date, prefs: Preferences): boolean {
  const m = hmToMinutes(toHm(at, prefs.timeZone));
  const qs = hmToMinutes(prefs.quietStart);
  const qe = hmToMinutes(prefs.quietEnd);
  if (qs === qe) return false;
  return qs < qe ? m >= qs && m < qe : m >= qs || m < qe;
}

/** If `at` falls in quiet hours, the moment quiet hours end; otherwise `at`. */
export function afterQuietHours(at: Date, prefs: Preferences): Date {
  if (!isQuiet(at, prefs)) return at;
  const tz = prefs.timeZone;
  const ymd = toYmd(at, tz);
  const todayEnd = zonedToInstant(ymd, prefs.quietEnd, tz);
  return todayEnd > at ? todayEnd : zonedToInstant(addDaysYmd(ymd, 1), prefs.quietEnd, tz);
}

/**
 * A reminder at the item's own time (or at a set instant) is exactly what was asked for,
 * so quiet hours don't delay it. Only advance warnings wait for quiet hours to end.
 */
function fireTime(at: Date, r: Reminder, prefs: Preferences): Date {
  return r.rule.type === "before" && r.rule.minutes > 0 ? afterQuietHours(at, prefs) : at;
}

/** The next time this reminder should fire after `after`, ignoring snooze. */
export function nextFireTime(state: AppState, r: Reminder, after: Date): { at: Date; occurrenceStart?: string } | null {
  const target = state.items[r.target.id];
  if (!target) return null;
  if (r.rule.type === "at") {
    const at = new Date(r.rule.at);
    return at > after ? { at } : null;
  }
  const minutesBefore = r.rule.minutes;
  if (target.kind === "event") {
    const ev = target as CalendarEvent;
    const from = addMinutes(after, minutesBefore);
    const occ = occurrencesInRange(ev, from, addMinutes(from, 60 * 24 * 400)).find((o) => new Date(o.start) > from);
    if (!occ) return null;
    return { at: addMinutes(occ.start, -minutesBefore), occurrenceStart: occ.start };
  }
  if (target.kind === "task") {
    const t = target as Task;
    if (t.status !== "open") return null;
    const anchor = t.scheduled?.start ?? t.due;
    if (!anchor) return null;
    const at = addMinutes(anchor, -minutesBefore);
    return at > after ? { at } : null;
  }
  return null;
}

function describe(state: AppState, r: Reminder, occurrenceStart?: string): { title: string; body: string; url: string } {
  const target = state.items[r.target.id];
  const tz = state.prefs.timeZone;
  if (!target || !("title" in target)) return { title: "תזכורת", body: "", url: "/" };
  if (state.prefs.hideNotificationContent) {
    return { title: "ראש שקט", body: "יש לך תזכורת", url: `/item/${target.id}` };
  }
  if (target.kind === "event") {
    const start = occurrenceStart ?? target.start;
    const loc = target.location ? ` · ${target.location}` : "";
    const lead = r.rule.type === "before" ? `בעוד ${formatDurationHe(r.rule.minutes)} · ` : "";
    return { title: target.title, body: `${lead}${toHm(new Date(start), tz)}${loc}`, url: `/item/${target.id}` };
  }
  return { title: target.title, body: "הגיע הזמן למשימה", url: `/item/${target.id}` };
}

/**
 * Notifications that should be shown now.
 * Snooze only delays the reminder; the event's own time never changes.
 */
export function dueNotifications(state: AppState, now: Date): DueNotification[] {
  const out: DueNotification[] = [];
  for (const item of Object.values(state.items)) {
    if (item.kind !== "reminder") continue;
    const r = item;
    if (r.state === "dismissed" || r.state === "done") continue;
    const lastShown = r.lastShownAt ? new Date(r.lastShownAt) : new Date(new Date(r.createdAt).getTime() - 1);
    let fireAt: Date | null = null;
    let occurrenceStart: string | undefined;

    if (r.state === "snoozed" && r.snoozedUntil) {
      fireAt = new Date(r.snoozedUntil);
      if (fireAt <= lastShown) fireAt = null;
    } else {
      const next = nextFireTime(state, r, lastShown);
      if (next) {
        fireAt = fireTime(next.at, r, state.prefs);
        occurrenceStart = next.occurrenceStart;
      }
    }
    if (!fireAt || fireAt > now || now.getTime() - fireAt.getTime() > MAX_LATE_MS) continue;
    const d = describe(state, r, occurrenceStart);
    out.push({
      reminderId: r.id,
      tag: `${r.id}:${occurrenceStart ?? fireAt.toISOString()}`,
      fireAt: fireAt.toISOString(),
      targetKind: r.target.kind,
      targetId: r.target.id,
      ...d,
    });
  }
  return out.sort((a, b) => a.fireAt.localeCompare(b.fireAt));
}

/** Next instant anything needs to fire, to set a single timer. */
export function nextWakeUp(state: AppState, now: Date): Date | null {
  let best: Date | null = null;
  for (const item of Object.values(state.items)) {
    if (item.kind !== "reminder" || item.state === "dismissed" || item.state === "done") continue;
    let at: Date | null = null;
    if (item.state === "snoozed" && item.snoozedUntil) at = new Date(item.snoozedUntil);
    else {
      const last = item.lastShownAt ? new Date(item.lastShownAt) : now;
      const n = nextFireTime(state, item, last > now ? last : now);
      at = n ? fireTime(n.at, item, state.prefs) : null;
    }
    if (at && at > now && (!best || at < best)) best = at;
  }
  return best;
}

export function markShownOp(state: AppState, ids: string[], now: Date, opId: string): Op {
  const put = ids
    .map((id) => state.items[id])
    .filter((r): r is Reminder => r?.kind === "reminder")
    .map((r) => touch(r, now, { lastShownAt: now.toISOString(), state: r.state === "snoozed" ? "pending" : r.state, snoozedUntil: undefined }));
  return { opId, label: "הצגת תזכורת", source: "system", put };
}

/**
 * Adds the default reminders to upcoming timed items that have none, so items saved
 * before reminders were automatic also ring. Past and untimed items are left alone.
 */
export function addMissingRemindersOp(state: AppState, minutes: number[], now: Date, opId: string): Op {
  const iso = now.toISOString();
  const hasReminder = new Set<string>();
  for (const i of Object.values(state.items)) if (i.kind === "reminder") hasReminder.add(i.target.id);
  const put: Reminder[] = [];
  for (const i of Object.values(state.items)) {
    if (hasReminder.has(i.id)) continue;
    let kind: "event" | "task";
    if (i.kind === "event") {
      const upcoming = i.recurrence ? occurrencesInRange(i, now, addMinutes(now, 60 * 24 * 400)).length > 0 : new Date(i.start) > now;
      if (!upcoming) continue;
      kind = "event";
    } else if (i.kind === "task") {
      const anchor = i.scheduled?.start ?? (i.dueIsDateOnly ? undefined : i.due);
      if (i.status !== "open" || !anchor || new Date(anchor) <= now) continue;
      kind = "task";
    } else continue;
    for (const m of minutes) {
      put.push({ id: newId("r"), kind: "reminder", target: { kind, id: i.id }, rule: { type: "before", minutes: m }, channel: "notification", state: "pending", createdAt: iso, updatedAt: iso });
    }
  }
  return { opId, label: "נוספו תזכורות", source: "manual", put };
}

export function snoozeOp(r: Reminder, minutes: number, now: Date, opId: string): Op {
  return {
    opId,
    label: `דחיית תזכורת ב־${formatDurationHe(minutes)}`,
    source: "manual",
    put: [touch(r, now, { state: "snoozed", snoozedUntil: addMinutes(now, minutes).toISOString(), lastShownAt: now.toISOString() })],
  };
}

export function reminderLabelHe(r: Reminder, tz: string): string {
  if (r.rule.type === "before") return r.rule.minutes === 0 ? "בזמן" : `${formatDurationHe(r.rule.minutes)} לפני`;
  return `ב־${toHm(new Date(r.rule.at), tz)}`;
}
