import { addMinutes, startOfDay, type Ymd } from "../time";
import { agendaForDay, unscheduledDueOn, type Interval } from "./agenda";
import { planDay, type Placement } from "./planner";
import { tasks, touch, type Op } from "./store-core";
import type { AppState, Task } from "./types";

/** What the user reports when "היום השתבש". */
export type Disruption =
  | { type: "lateStart"; until: string }
  | { type: "extended"; eventId: string; occurrenceEnd: string; minutes: number }
  | { type: "unavailable"; start: string; end: string };

export interface ReplanDiff {
  ymd: Ymd;
  blocks: Interval[];
  kept: Placement[];
  moved: (Placement & { from: { start: string; end: string } })[];
  added: Placement[];
  postponed: { taskId: string; title: string; reason: string; dueToday: boolean }[];
  overloaded: boolean;
}

export function disruptionBlocks(disruptions: Disruption[], ymd: Ymd, tz: string): { blocks: Interval[]; startAt?: Date } {
  const blocks: Interval[] = [];
  let startAt: Date | undefined;
  for (const d of disruptions) {
    if (d.type === "lateStart") {
      const at = new Date(d.until);
      if (!startAt || at > startAt) startAt = at;
    } else if (d.type === "extended") {
      blocks.push({ start: d.occurrenceEnd, end: addMinutes(d.occurrenceEnd, d.minutes).toISOString() });
    } else {
      blocks.push({ start: d.start, end: d.end });
    }
  }
  if (startAt) blocks.push({ start: startOfDay(ymd, tz).toISOString(), end: startAt.toISOString() });
  return { blocks, startAt };
}

/**
 * Proposes a new version of today's task plan after a disruption.
 * Fixed events are never touched; the result is a diff for the user to review.
 */
export function replanAfterDisruption(state: AppState, ymd: Ymd, disruptions: Disruption[], now: Date): ReplanDiff {
  const tz = state.prefs.timeZone;
  const { blocks, startAt } = disruptionBlocks(disruptions, ymd, tz);

  const scheduledToday = agendaForDay(state, ymd, tz)
    .filter((e): e is Extract<typeof e, { type: "task" }> => e.type === "task" && e.task.status === "open")
    .map((e) => e.task);
  // Slots already in the past stay as they are.
  const reconsider = scheduledToday.filter((t) => new Date(t.scheduled!.end) > now);
  const dueToday = unscheduledDueOn(state, ymd, tz);
  const only = [...new Set([...reconsider, ...dueToday].map((t) => t.id))];

  const plan = planDay(state, ymd, { now, blocked: blocks, startAt, only });
  const before = new Map<string, Task>(reconsider.map((t) => [t.id, t]));

  const diff: ReplanDiff = { ymd, blocks, kept: [], moved: [], added: [], postponed: [], overloaded: plan.overloaded };
  for (const p of plan.placements) {
    const prev = before.get(p.taskId);
    if (!prev) diff.added.push(p);
    else if (prev.scheduled!.start === p.start && prev.scheduled!.end === p.end) diff.kept.push(p);
    else diff.moved.push({ ...p, from: prev.scheduled! });
  }
  for (const u of plan.unplaced) {
    diff.postponed.push({ ...u, reason: u.dueToday ? `${u.reason} — דורש החלטה` : `${u.reason} — יעבור ליום אחר` });
  }
  return diff;
}

/** Applying the reviewed diff: new slots for kept/moved/added, slot cleared for postponed. */
export function applyReplanOp(state: AppState, diff: ReplanDiff, opId: string, now: Date): Op {
  const byId = new Map(tasks(state).map((t) => [t.id, t]));
  const put: Task[] = [];
  for (const p of [...diff.moved, ...diff.added]) {
    const t = byId.get(p.taskId);
    if (t) put.push(touch(t, now, { scheduled: { start: p.start, end: p.end } }));
  }
  for (const u of diff.postponed) {
    const t = byId.get(u.taskId);
    if (t?.scheduled) put.push(touch(t, now, { scheduled: undefined }));
  }
  return { opId, label: "עדכון תוכנית היום אחרי שינוי", source: "plan", put };
}

export function applyPlanOp(state: AppState, placements: Placement[], opId: string, now: Date): Op {
  const byId = new Map(tasks(state).map((t) => [t.id, t]));
  const put = placements
    .map((p) => {
      const t = byId.get(p.taskId);
      return t ? touch(t, now, { scheduled: { start: p.start, end: p.end } }) : null;
    })
    .filter((t): t is Task => t !== null);
  return { opId, label: `אישור תוכנית יומית (${put.length} משימות)`, source: "plan", put };
}
