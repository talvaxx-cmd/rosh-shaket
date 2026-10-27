import { endOfDay, formatDurationHe, toHm, zonedToInstant, type Ymd } from "../time";
import { agendaForDay, type Interval } from "./agenda";
import { tasks } from "./store-core";
import type { AppState, Importance, Preferences, Task } from "./types";

/**
 * Daily planning engine.
 *
 * Guarantees (from the spec's acceptance tests):
 *  - Only free windows inside active hours are used; fixed events are never moved.
 *  - Deadlines and dependencies are respected; a buffer is kept around commitments.
 *  - When there isn't enough time, the result says so (overloaded) instead of
 *    pretending an impossible plan works.
 *  - Producing a plan changes nothing. Applying it is a separate, explicit step.
 */

export interface Placement {
  taskId: string;
  title: string;
  start: string;
  end: string;
  /** Short Hebrew explanation shown to the user. */
  reason: string;
  durationAssumed: boolean;
}

export interface Unplaced {
  taskId: string;
  title: string;
  reason: string;
  /** True when the task must happen within the planned day (deadline, or prep for a meeting that day). */
  dueToday: boolean;
}

export interface Plan {
  ymd: Ymd;
  placements: Placement[];
  unplaced: Unplaced[];
  /** Minutes of free time in the day (after buffers) vs minutes needed by tasks considered. */
  freeMinutes: number;
  neededMinutes: number;
  overloaded: boolean;
}

export interface PlanOptions {
  now: Date;
  /** Extra unavailable blocks (e.g. "היום השתבש"). */
  blocked?: Interval[];
  /** Override the start of the active day (late start). */
  startAt?: Date;
  /** Tasks to leave out (user chose to drop/postpone them). */
  exclude?: string[];
  /** Restrict planning to these task ids. */
  only?: string[];
  /** Keep already-scheduled task slots fixed instead of re-planning them. */
  keepScheduled?: boolean;
}

const IMPORTANCE_RANK: Record<Importance, number> = { high: 0, normal: 1, low: 2 };

function windowBounds(window: Task["preferredWindow"]): [string, string] | null {
  switch (window) {
    case "morning":
      return ["06:00", "12:00"];
    case "afternoon":
      return ["12:00", "17:00"];
    case "evening":
      return ["17:00", "23:00"];
    default:
      return null;
  }
}

function subtract(free: Interval[], block: Interval): Interval[] {
  const bs = new Date(block.start).getTime();
  const be = new Date(block.end).getTime();
  const out: Interval[] = [];
  for (const f of free) {
    const fs = new Date(f.start).getTime();
    const fe = new Date(f.end).getTime();
    if (be <= fs || bs >= fe) {
      out.push(f);
      continue;
    }
    if (bs > fs) out.push({ start: f.start, end: new Date(bs).toISOString() });
    if (be < fe) out.push({ start: new Date(be).toISOString(), end: f.end });
  }
  return out;
}

const minutes = (i: Interval) => (new Date(i.end).getTime() - new Date(i.start).getTime()) / 60000;

/** Topological order honoring dependsOn; cycles are broken by leaving the remaining tasks in priority order. */
function orderTasks(list: Task[], allTasks: Map<string, Task>): Task[] {
  const priority = (t: Task) => [
    t.due ? new Date(t.due).getTime() : Number.MAX_SAFE_INTEGER,
    IMPORTANCE_RANK[t.importance],
    t.createdAt,
  ] as const;
  const sorted = [...list].sort((a, b) => {
    const pa = priority(a);
    const pb = priority(b);
    return pa[0] - pb[0] || pa[1] - pb[1] || pa[2].localeCompare(pb[2]);
  });
  const ids = new Set(sorted.map((t) => t.id));
  const placed = new Set<string>();
  const out: Task[] = [];
  let progress = true;
  while (out.length < sorted.length && progress) {
    progress = false;
    for (const t of sorted) {
      if (placed.has(t.id)) continue;
      const ready = t.dependsOn.every((d) => !ids.has(d) || placed.has(d) || allTasks.get(d)?.status === "done");
      if (ready) {
        out.push(t);
        placed.add(t.id);
        progress = true;
        break;
      }
    }
  }
  for (const t of sorted) if (!placed.has(t.id)) out.push(t);
  return out;
}

export function planDay(state: AppState, ymd: Ymd, opts: PlanOptions): Plan {
  const prefs: Preferences = state.prefs;
  const tz = prefs.timeZone;
  const buffer = prefs.bufferMin;
  const dayStart = zonedToInstant(ymd, prefs.dayStart, tz);
  const dayEnd = prefs.dayEnd > prefs.dayStart ? zonedToInstant(ymd, prefs.dayEnd, tz) : endOfDay(ymd, tz);
  const begin = new Date(Math.max(dayStart.getTime(), opts.now.getTime(), opts.startAt?.getTime() ?? 0));

  let free: Interval[] = begin < dayEnd ? [{ start: begin.toISOString(), end: dayEnd.toISOString() }] : [];

  const agenda = agendaForDay(state, ymd, tz);
  const exclude = new Set(opts.exclude ?? []);
  const eventStarts = new Map<string, string>();
  for (const entry of agenda) {
    if (entry.type === "event") {
      eventStarts.set(entry.id, entry.start);
    } else if (!opts.keepScheduled || entry.task.status !== "open" || exclude.has(entry.id)) {
      continue;
    }
    free = subtract(free, {
      start: new Date(new Date(entry.start).getTime() - buffer * 60000).toISOString(),
      end: new Date(new Date(entry.end).getTime() + buffer * 60000).toISOString(),
    });
  }
  for (const b of opts.blocked ?? []) free = subtract(free, b);
  free = free.filter((f) => minutes(f) >= 5);
  const freeMinutes = Math.round(free.reduce((s, f) => s + minutes(f), 0));

  const allTasks = new Map(tasks(state).map((t) => [t.id, t]));
  const endOfPlannedDay = endOfDay(ymd, tz);
  const candidates = tasks(state).filter((t) => {
    if (t.status !== "open" || !t.flexible || exclude.has(t.id)) return false;
    if (opts.only && !opts.only.includes(t.id)) return false;
    if (opts.keepScheduled && t.scheduled) return false;
    return !(t.notBefore && new Date(t.notBefore) >= endOfPlannedDay);
  });

  const ordered = orderTasks(candidates, allTasks);
  const placements: Placement[] = [];
  const unplaced: Unplaced[] = [];
  const finishedAt = new Map<string, number>();
  let neededMinutes = 0;

  for (const t of ordered) {
    const dur = t.durationMin ?? prefs.defaultTaskMin;
    const assumed = t.durationMin == null || Boolean(t.durationAssumed);
    const dueMs = t.due ? new Date(t.due).getTime() : Number.POSITIVE_INFINITY;
    const dueToday = dueMs < endOfPlannedDay.getTime();
    const dueLater = !dueToday && Number.isFinite(dueMs);
    const prepEventStart = t.prepFor ? eventStarts.get(t.prepFor) : undefined;
    // Must happen within this day: deadline today, or preparation for a meeting today.
    const mustToday = dueToday || Boolean(prepEventStart);
    if (mustToday) neededMinutes += dur;

    let latestEnd = dueMs;
    if (prepEventStart) latestEnd = Math.min(latestEnd, new Date(prepEventStart).getTime() - buffer * 60000);
    let earliest = 0;
    for (const dep of t.dependsOn) {
      const depTask = allTasks.get(dep);
      if (!depTask || depTask.status === "done") continue;
      const f = finishedAt.get(dep);
      if (f == null) {
        earliest = Number.POSITIVE_INFINITY;
        break;
      }
      earliest = Math.max(earliest, f + buffer * 60000);
    }
    if (!Number.isFinite(earliest)) {
      unplaced.push({ taskId: t.id, title: t.title, reason: "ממתינה למשימה קודמת שלא שובצה", dueToday: mustToday });
      continue;
    }

    const pref = windowBounds(t.preferredWindow ?? prefs.focusWindow);
    const tryFit = (respectWindow: boolean): { start: number; end: number } | null => {
      for (const f of free) {
        let s = Math.max(new Date(f.start).getTime(), earliest);
        let e = new Date(f.end).getTime();
        if (respectWindow && pref) {
          s = Math.max(s, zonedToInstant(ymd, pref[0], tz).getTime());
          e = Math.min(e, zonedToInstant(ymd, pref[1], tz).getTime());
        }
        // Round start up to 5 minutes for readable times.
        s = Math.ceil(s / 300000) * 300000;
        const end = s + dur * 60000;
        if (end <= e && end <= latestEnd) return { start: s, end };
      }
      return null;
    };
    const slot = tryFit(true) ?? tryFit(false);

    if (!slot) {
      const reason = prepEventStart
        ? `אין חלון פנוי של ${formatDurationHe(dur)} לפני הפגישה`
        : mustToday
          ? `אין חלון פנוי של ${formatDurationHe(dur)} לפני המועד האחרון`
          : `אין חלון פנוי של ${formatDurationHe(dur)} היום`;
      unplaced.push({ taskId: t.id, title: t.title, reason, dueToday: mustToday });
      continue;
    }

    if (!mustToday) neededMinutes += dur;
    free = subtract(free, {
      start: new Date(slot.start).toISOString(),
      end: new Date(slot.end + buffer * 60000).toISOString(),
    });
    finishedAt.set(t.id, slot.end);

    let reason: string;
    if (prepEventStart) reason = "שובץ כאן כדי להספיק לפני הפגישה";
    else if (dueToday) reason = `שובץ כאן כי קיים חלון פנוי לפני המועד האחרון (${toHm(new Date(dueMs), tz)})`;
    else if (dueLater) reason = "שובץ כאן כי קיים חלון פנוי לפני המועד האחרון";
    else if (t.dependsOn.length) reason = "שובץ אחרי המשימה שהיא תלויה בה";
    else if (pref && t.preferredWindow) reason = "שובץ בחלק היום שביקשת";
    else reason = "שובץ בחלון הפנוי הראשון";
    if (assumed) reason += ` · משך משוער ${formatDurationHe(dur)} — אפשר לערוך`;

    placements.push({
      taskId: t.id,
      title: t.title,
      start: new Date(slot.start).toISOString(),
      end: new Date(slot.end).toISOString(),
      reason,
      durationAssumed: assumed,
    });
  }

  // Overloaded = something that must happen today (deadline today or prep for today's meeting) did not fit.
  const overloaded = unplaced.some((u) => u.dueToday);
  placements.sort((a, b) => a.start.localeCompare(b.start));
  return { ymd, placements, unplaced, freeMinutes, neededMinutes, overloaded };
}
