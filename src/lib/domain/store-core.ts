import { addDaysYmd, toHm, toYmd, zonedToInstant, type Ymd } from "../time";
import {
  DEFAULT_PREFERENCES,
  type AppState,
  type CalendarEvent,
  type HistoryEntry,
  type Item,
  type ItemSource,
  type Preferences,
  type Reminder,
  type Task,
} from "./types";

const HISTORY_LIMIT = 500;

export function newId(prefix = "i"): string {
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
      : Math.random().toString(36).slice(2, 18);
  return `${prefix}_${rnd}`;
}

export function emptyState(prefs: Partial<Preferences> = {}): AppState {
  return { version: 1, items: {}, prefs: { ...DEFAULT_PREFERENCES, ...prefs }, history: [] };
}

/**
 * One atomic, idempotent change. Built by the UI after confirmation, then applied.
 * `opId` is created once per user intent, so a retry of the same save never duplicates.
 */
export interface Op {
  opId: string;
  label: string;
  source: HistoryEntry["source"];
  put?: Item[];
  remove?: string[];
}

export interface ApplyResult {
  state: AppState;
  /** False when this opId was already applied (a retry) — nothing changed. */
  applied: boolean;
}

export function hasApplied(state: AppState, opId: string): boolean {
  return state.history.some((h) => h.opId === opId);
}

export function applyOp(state: AppState, op: Op, now: Date = new Date()): ApplyResult {
  if (hasApplied(state, op.opId)) return { state, applied: false };
  const items = { ...state.items };
  const before: HistoryEntry["before"] = {};
  const after: HistoryEntry["after"] = {};

  for (const id of op.remove ?? []) {
    if (!(id in before)) before[id] = items[id] ?? null;
    delete items[id];
    after[id] = null;
  }
  for (const item of op.put ?? []) {
    if (!(item.id in before)) before[item.id] = items[item.id] ?? null;
    items[item.id] = item;
    after[item.id] = item;
  }

  const entry: HistoryEntry = {
    opId: op.opId,
    at: now.toISOString(),
    label: op.label,
    source: op.source,
    before,
    after,
  };
  const history = [entry, ...state.history].slice(0, HISTORY_LIMIT);
  return { state: { ...state, items, history }, applied: true };
}

export type UndoResult =
  | { ok: true; state: AppState }
  | { ok: false; reason: "not_found" | "already_undone" | "changed_since"; changedIds?: string[] };

/**
 * Restores the items an operation touched to their previous state.
 * Refuses when an item was changed again afterwards, so an undo never silently
 * discards a later edit.
 */
export function undoOp(state: AppState, opId: string, undoOpId: string, now: Date = new Date()): UndoResult {
  const entry = state.history.find((h) => h.opId === opId);
  if (!entry) return { ok: false, reason: "not_found" };
  if (entry.undoneBy) return { ok: false, reason: "already_undone" };
  if (hasApplied(state, undoOpId)) return { ok: true, state };

  const changedIds = Object.keys(entry.after).filter((id) => {
    const current = state.items[id] ?? null;
    const expected = entry.after[id] ?? null;
    if (current === null || expected === null) return current !== expected;
    return current.updatedAt !== expected.updatedAt;
  });
  if (changedIds.length) return { ok: false, reason: "changed_since", changedIds };

  const put: Item[] = [];
  const remove: string[] = [];
  for (const [id, prev] of Object.entries(entry.before)) {
    if (prev) put.push(prev);
    else remove.push(id);
  }
  const res = applyOp(state, { opId: undoOpId, label: `ביטול: ${entry.label}`, source: "undo", put, remove }, now);
  const history = res.state.history.map((h) => (h.opId === opId ? { ...h, undoneBy: undoOpId } : h));
  return { ok: true, state: { ...res.state, history } };
}

// ---------- typed selectors ----------

export function events(state: AppState): CalendarEvent[] {
  return Object.values(state.items).filter((i): i is CalendarEvent => i.kind === "event");
}

export function tasks(state: AppState): Task[] {
  return Object.values(state.items).filter((i): i is Task => i.kind === "task");
}

export function reminders(state: AppState): Reminder[] {
  return Object.values(state.items).filter((i): i is Reminder => i.kind === "reminder");
}

export function remindersFor(state: AppState, targetId: string): Reminder[] {
  return reminders(state).filter((r) => r.target.id === targetId);
}

// ---------- op builders ----------

export function touch<T extends Item>(item: T, now: Date, patch: Partial<T> = {}): T {
  return { ...item, ...patch, updatedAt: now.toISOString() };
}

/** Deleting an item also deletes its reminders and unlinks dependent tasks, in one undoable op. */
export function deleteItemOp(state: AppState, id: string, opId: string, now: Date, source: ItemSource = "manual"): Op {
  const item = state.items[id];
  const remove = [id, ...remindersFor(state, id).map((r) => r.id)];
  const put: Item[] = tasks(state)
    .filter((t) => t.prepFor === id || t.dependsOn.includes(id))
    .map((t) =>
      touch(t, now, {
        prepFor: t.prepFor === id ? undefined : t.prepFor,
        dependsOn: t.dependsOn.filter((d) => d !== id),
      }),
    );
  return { opId, label: `מחיקה: ${item && "title" in item ? item.title : "פריט"}`, source, remove, put };
}

export function completeTaskOp(task: Task, done: boolean, opId: string, now: Date): Op {
  return {
    opId,
    label: `${done ? "בוצע" : "הוחזר לפתוח"}: ${task.title}`,
    source: "manual",
    put: [
      touch(task, now, {
        status: done ? "done" : "open",
        completedAt: done ? now.toISOString() : undefined,
      }),
    ],
  };
}

export type RecurringScope = "this" | "following" | "all";

export interface EventChange {
  title?: string;
  location?: string;
  /** New start / end for the edited occurrence, instants. */
  start?: string;
  end?: string;
}

/**
 * Edit one occurrence, this-and-following, or the whole series.
 * Never changes the whole series unless the caller explicitly chose "all".
 */
export function editRecurringEventOp(
  event: CalendarEvent,
  occurrenceKey: Ymd,
  occurrenceStart: string,
  change: EventChange,
  scope: RecurringScope,
  opId: string,
  now: Date,
): Op {
  const tz = event.timeZone;
  const durationMs = new Date(event.end).getTime() - new Date(event.start).getTime();
  const occStartMs = new Date(occurrenceStart).getTime();
  const newStart = change.start ?? occurrenceStart;
  const newEnd = change.end ?? new Date(new Date(newStart).getTime() + durationMs).toISOString();

  if (!event.recurrence || scope === "all") {
    // Shift the series anchor by the same delta the user applied to this occurrence.
    const delta = new Date(newStart).getTime() - occStartMs;
    const start = new Date(new Date(event.start).getTime() + delta).toISOString();
    const end = new Date(new Date(start).getTime() + (new Date(newEnd).getTime() - new Date(newStart).getTime())).toISOString();
    return {
      opId,
      label: `עדכון${event.recurrence ? " הסדרה" : ""}: ${change.title ?? event.title}`,
      source: "manual",
      put: [touch(event, now, { start, end, title: change.title ?? event.title, location: change.location ?? event.location })],
    };
  }

  if (scope === "this") {
    return {
      opId,
      label: `עדכון מופע יחיד: ${event.title}`,
      source: "manual",
      put: [
        touch(event, now, {
          overrides: {
            ...event.overrides,
            [occurrenceKey]: { kind: "moved", start: newStart, end: newEnd, title: change.title, location: change.location },
          },
        }),
      ],
    };
  }

  // "following": end the old series the day before, start a new series at this occurrence.
  const firstYmd = toYmd(new Date(event.start), tz);
  const oldSeries = touch(event, now, {
    recurrence: { ...event.recurrence, until: addDaysYmd(occurrenceKey, -1) },
  });
  const newSeries: CalendarEvent = {
    ...event,
    id: newId("e"),
    title: change.title ?? event.title,
    location: change.location ?? event.location,
    start: newStart,
    end: newEnd,
    overrides: Object.fromEntries(Object.entries(event.overrides ?? {}).filter(([k]) => k > occurrenceKey)),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  const ops: Item[] = occurrenceKey <= firstYmd ? [newSeries] : [oldSeries, newSeries];
  return {
    opId,
    label: `עדכון מופע זה והבאים: ${event.title}`,
    source: "manual",
    put: ops,
    remove: occurrenceKey <= firstYmd ? [event.id] : [],
  };
}

export function cancelOccurrenceOp(
  state: AppState,
  event: CalendarEvent,
  occurrenceKey: Ymd,
  scope: RecurringScope,
  opId: string,
  now: Date,
): Op {
  if (!event.recurrence || scope === "all") return deleteItemOp(state, event.id, opId, now);
  if (scope === "this") {
    return {
      opId,
      label: `ביטול מופע יחיד: ${event.title}`,
      source: "manual",
      put: [touch(event, now, { overrides: { ...event.overrides, [occurrenceKey]: { kind: "cancelled" } } })],
    };
  }
  const firstYmd = toYmd(new Date(event.start), event.timeZone);
  if (occurrenceKey <= firstYmd) return deleteItemOp(state, event.id, opId, now);
  return {
    opId,
    label: `ביטול מופע זה והבאים: ${event.title}`,
    source: "manual",
    put: [touch(event, now, { recurrence: { ...event.recurrence, until: addDaysYmd(occurrenceKey, -1) } })],
  };
}

/** Wall-clock start of an event in its own zone — used to show both local and original time when zones differ. */
export function eventWallClock(event: CalendarEvent): { ymd: Ymd; hm: string } {
  const d = new Date(event.start);
  return { ymd: toYmd(d, event.timeZone), hm: toHm(d, event.timeZone) };
}

export function instantFromLocal(ymd: Ymd, hmStr: string, tz: string): string {
  return zonedToInstant(ymd, hmStr, tz).toISOString();
}
