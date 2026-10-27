import { addDaysYmd, startOfDay, toYmd } from "../time";
import { findConflicts, overdueTasks, unscheduledDueOn, type Conflict } from "./agenda";
import type { AppState, Task, Unresolved } from "./types";

export interface Attention {
  conflicts: Conflict[];
  overdue: Task[];
  unresolved: Unresolved[];
  dueTodayUnscheduled: Task[];
  total: number;
}

/** Everything "דורש טיפול": conflicts in the next two weeks, overdue tasks, open questions. */
export function attention(state: AppState, now: Date): Attention {
  const tz = state.prefs.timeZone;
  const today = toYmd(now, tz);
  const conflicts = findConflicts(state, now, startOfDay(addDaysYmd(today, 14), tz));
  const overdue = overdueTasks(state, now);
  const unresolved = Object.values(state.items).filter((i): i is Unresolved => i.kind === "unresolved");
  const dueTodayUnscheduled = unscheduledDueOn(state, today, tz).filter((t) => !overdue.includes(t));
  return {
    conflicts,
    overdue,
    unresolved,
    dueTodayUnscheduled,
    total: conflicts.length + overdue.length + unresolved.length,
  };
}
