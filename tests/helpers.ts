import { applyOp, emptyState } from "@/lib/domain/store-core";
import type { AppState, CalendarEvent, Task } from "@/lib/domain/types";
import { zonedToInstant } from "@/lib/time";

export const TZ = "Asia/Jerusalem";
export const at = (ymd: string, hm: string) => zonedToInstant(ymd, hm, TZ);
export const ctxAt = (ymd: string, hm: string) => ({
  now: at(ymd, hm).toISOString(),
  timeZone: TZ,
  dayStart: "08:00",
  dayEnd: "20:00",
  defaultEventMin: 60,
  defaultTaskMin: 30,
});

const ISO = "2026-10-01T00:00:00.000Z";

export function ev(id: string, ymd: string, start: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id,
    kind: "event",
    title: id,
    start: at(ymd, start).toISOString(),
    end: at(ymd, end).toISOString(),
    timeZone: TZ,
    source: "manual",
    createdAt: ISO,
    updatedAt: ISO,
    ...extra,
  };
}

export function task(id: string, extra: Partial<Task> = {}): Task {
  return {
    id,
    kind: "task",
    title: id,
    status: "open",
    importance: "normal",
    flexible: true,
    dependsOn: [],
    timeZone: TZ,
    source: "manual",
    createdAt: ISO,
    updatedAt: ISO,
    ...extra,
  };
}

export function stateWith(items: (CalendarEvent | Task)[], prefs: Partial<AppState["prefs"]> = {}): AppState {
  return applyOp(emptyState({ timeZone: TZ, bufferMin: 0, ...prefs }), { opId: "seed", label: "seed", source: "system", put: items }).state;
}
