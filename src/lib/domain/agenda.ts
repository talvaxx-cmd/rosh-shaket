import { endOfDay, startOfDay, toYmd, type Ymd } from "../time";
import { occurrencesInRange, type Occurrence } from "./recurrence";
import { events, tasks } from "./store-core";
import type { AppState, Task } from "./types";

export type AgendaEntry =
  | { type: "event"; id: string; occ: Occurrence; start: string; end: string }
  | { type: "task"; id: string; task: Task; start: string; end: string };

export function occurrencesBetween(state: AppState, from: Date, to: Date): Occurrence[] {
  return events(state)
    .flatMap((e) => occurrencesInRange(e, from, to))
    .sort((a, b) => a.start.localeCompare(b.start));
}

/** Events and scheduled tasks on one local day, on a single timeline. */
export function agendaForDay(state: AppState, ymd: Ymd, tz: string): AgendaEntry[] {
  const from = startOfDay(ymd, tz);
  const to = endOfDay(ymd, tz);
  const out: AgendaEntry[] = occurrencesBetween(state, from, to).map((occ) => ({
    type: "event" as const,
    id: occ.eventId,
    occ,
    start: occ.start,
    end: occ.end,
  }));
  for (const t of tasks(state)) {
    if (!t.scheduled || t.status === "dropped") continue;
    const s = new Date(t.scheduled.start);
    if (s >= from && s < to) out.push({ type: "task", id: t.id, task: t, start: t.scheduled.start, end: t.scheduled.end });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || (a.type === "event" ? -1 : 1));
}

/**
 * Local day a task is due. A date-only deadline is stored as midnight at the end
 * of that day, so it is read one millisecond earlier to land on the right day.
 */
export function taskDueYmd(t: Task, tz: string): Ymd | null {
  if (!t.due) return null;
  return toYmd(new Date(new Date(t.due).getTime() - (t.dueIsDateOnly ? 1 : 0)), tz);
}

/** Open tasks with a deadline on this local day that have no slot yet. */
export function unscheduledDueOn(state: AppState, ymd: Ymd, tz: string): Task[] {
  return tasks(state).filter((t) => t.status === "open" && !t.scheduled && taskDueYmd(t, tz) === ymd);
}

/** Open tasks for the Today screen: due today (not yet scheduled) and undated ones. */
export function todayTasks(state: AppState, ymd: Ymd, tz: string, now: Date): { dueToday: Task[]; undated: Task[] } {
  const open = tasks(state).filter((t) => t.status === "open" && !t.scheduled);
  const started = (t: Task) => !t.notBefore || new Date(t.notBefore) <= now;
  return {
    dueToday: open.filter((t) => taskDueYmd(t, tz) === ymd && new Date(t.due!) > now),
    undated: open
      .filter((t) => !t.due && started(t))
      .sort((a, b) => (a.importance === "high" ? 0 : 1) - (b.importance === "high" ? 0 : 1) || a.createdAt.localeCompare(b.createdAt)),
  };
}

export function overdueTasks(state: AppState, now: Date): Task[] {
  return tasks(state).filter((t) => t.status === "open" && t.due && new Date(t.due) < now);
}

// ---------- conflicts ----------

export interface Conflict {
  a: { id: string; key: Ymd; title: string; start: string; end: string };
  b: { id: string; key: Ymd; title: string; start: string; end: string };
}

export interface Interval {
  start: string;
  end: string;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return new Date(a.start) < new Date(b.end) && new Date(b.start) < new Date(a.end);
}

/** Overlapping event occurrences in a window. */
export function findConflicts(state: AppState, from: Date, to: Date): Conflict[] {
  const occ = occurrencesBetween(state, from, to);
  const out: Conflict[] = [];
  for (let i = 0; i < occ.length; i++) {
    for (let j = i + 1; j < occ.length; j++) {
      const a = occ[i]!;
      const b = occ[j]!;
      if (new Date(b.start) >= new Date(a.end)) continue;
      if (a.eventId === b.eventId && a.key === b.key) continue;
      if (overlaps(a, b)) {
        out.push({
          a: { id: a.eventId, key: a.key, title: a.title, start: a.start, end: a.end },
          b: { id: b.eventId, key: b.key, title: b.title, start: b.start, end: b.end },
        });
      }
    }
  }
  return out;
}

/** Existing occurrences a candidate slot would collide with. */
export function conflictsWith(state: AppState, candidate: Interval, ignoreEventId?: string): Occurrence[] {
  const from = new Date(new Date(candidate.start).getTime() - 86400000);
  const to = new Date(new Date(candidate.end).getTime() + 86400000);
  return occurrencesBetween(state, from, to).filter((o) => o.eventId !== ignoreEventId && overlaps(o, candidate));
}
