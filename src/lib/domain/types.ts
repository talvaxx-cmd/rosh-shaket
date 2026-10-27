import type { Hm, Ymd } from "../time";

/** Where an item came from. Kept for history and for trust ("האם זה אני אמרתי?"). */
export type ItemSource = "voice" | "text" | "manual" | "plan" | "calendar";

export type Importance = "low" | "normal" | "high";

export interface Recurrence {
  freq: "daily" | "weekly" | "monthly";
  /** Every N units. */
  interval: number;
  /** For weekly: 0 = Sunday … 6 = Saturday. Empty = same weekday as the first occurrence. */
  byWeekday?: number[];
  /** Last local date (inclusive) an occurrence may start on. */
  until?: Ymd;
}

/** Per-occurrence override of a recurring event, keyed by the occurrence's original local date. */
export type OccurrenceOverride =
  | { kind: "cancelled" }
  | { kind: "moved"; start: string; end: string; title?: string; location?: string };

/** A commitment with a start and an end. Never moved automatically. */
export interface CalendarEvent {
  id: string;
  kind: "event";
  title: string;
  /** Instant (UTC ISO). */
  start: string;
  /** Instant (UTC ISO). */
  end: string;
  /** Zone the user meant when the event was created — a later zone change does not reinterpret it. */
  timeZone: string;
  location?: string;
  notes?: string;
  recurrence?: Recurrence;
  overrides?: Record<Ymd, OccurrenceOverride>;
  source: ItemSource;
  createdAt: string;
  updatedAt: string;
}

export type TaskStatus = "open" | "done" | "dropped";

export interface Task {
  id: string;
  kind: "task";
  title: string;
  status: TaskStatus;
  /** Estimated minutes. */
  durationMin?: number;
  /** True when the duration was assumed by the system and not given by the user. */
  durationAssumed?: boolean;
  /** Deadline instant (end of the deadline). */
  due?: string;
  /** Display-level flag: the deadline is a whole day, not a precise time. */
  dueIsDateOnly?: boolean;
  importance: Importance;
  /** May the planner suggest a slot? Fixed tasks keep their scheduled slot. */
  flexible: boolean;
  /** Preferred part of day, a hint for the planner. */
  preferredWindow?: "morning" | "afternoon" | "evening";
  /** Earliest local date to work on it (e.g. "השבוע" → this week). */
  notBefore?: string;
  /** Tasks that must be done before this one. */
  dependsOn: string[];
  /** Event this task prepares for (must finish before it starts). */
  prepFor?: string;
  /** A slot the user accepted from a plan, or set themselves. */
  scheduled?: { start: string; end: string };
  recurrence?: Recurrence;
  timeZone: string;
  source: ItemSource;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type ReminderRule =
  | { type: "before"; minutes: number }
  | { type: "at"; at: string };

export type ReminderState = "pending" | "snoozed" | "done" | "dismissed";

export interface Reminder {
  id: string;
  kind: "reminder";
  target: { kind: "event" | "task"; id: string };
  rule: ReminderRule;
  channel: "notification";
  state: ReminderState;
  /** Snoozing changes only this, never the target's time. */
  snoozedUntil?: string;
  /** Instant the app handed the notification to the system. Not proof of delivery. */
  lastShownAt?: string;
  /** Instant the user opened / acted on it. */
  lastOpenedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** Something said that lacked essential detail and was saved for later clarification. */
export interface Unresolved {
  id: string;
  kind: "unresolved";
  text: string;
  question: string;
  createdAt: string;
  updatedAt: string;
}

export type Item = CalendarEvent | Task | Reminder | Unresolved;

export interface Preferences {
  locale: "he";
  timeZone: string;
  /** Working / active hours, local. */
  dayStart: Hm;
  dayEnd: Hm;
  quietStart: Hm;
  quietEnd: Hm;
  /** Minutes kept free between consecutive commitments. */
  bufferMin: number;
  defaultTaskMin: number;
  defaultEventMin: number;
  focusWindow?: "morning" | "afternoon" | "evening";
  dailySummary: boolean;
  dailySummaryAt: Hm;
  hideNotificationContent: boolean;
  saveDraftsLocally: boolean;
  /** Save clear items right away (no review card), with undo. Unclear ones still ask. */
  autoSave: boolean;
  onboarded: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  locale: "he",
  timeZone: "Asia/Jerusalem",
  dayStart: "08:00",
  dayEnd: "20:00",
  quietStart: "22:00",
  quietEnd: "07:00",
  bufferMin: 10,
  defaultTaskMin: 30,
  defaultEventMin: 60,
  dailySummary: false,
  dailySummaryAt: "07:30",
  hideNotificationContent: false,
  saveDraftsLocally: true,
  autoSave: true,
  onboarded: false,
};

export interface HistoryEntry {
  /** Operation id; re-applying the same id is a no-op (safe retries). */
  opId: string;
  at: string;
  /** Human readable, Hebrew. */
  label: string;
  source: ItemSource | "system" | "undo";
  /** Item snapshots before the operation; null = did not exist. */
  before: Record<string, Item | null>;
  /** Item snapshots after the operation; null = deleted. */
  after: Record<string, Item | null>;
  /** Set when this entry was undone (by the op with this id). */
  undoneBy?: string;
}

export interface AppState {
  version: 1;
  items: Record<string, Item>;
  prefs: Preferences;
  history: HistoryEntry[];
}
