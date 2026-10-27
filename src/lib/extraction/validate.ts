import { addDaysYmd, formatYmdHe, hmToMinutes, isHm, isYmd, toHm, toYmd, zonedToInstant } from "../time";
import { conflictsWith } from "../domain/agenda";
import { newId, type Op } from "../domain/store-core";
import type { AppState, CalendarEvent, Item, ItemSource, Reminder, Task, Unresolved } from "../domain/types";
import type { DraftItem, ExtractionContext, Uncertainty } from "./draft";

/**
 * The rules layer. The language component only *proposes*; this layer checks
 * fields, flags what's uncertain, and is the only path from a draft to stored items.
 */

function addUnique(d: DraftItem, u: Uncertainty) {
  if (!d.uncertainties.some((x) => x.field === u.field)) d.uncertainties.push(u);
}

export function validateDrafts(input: DraftItem[], ctx: ExtractionContext): DraftItem[] {
  const now = new Date(ctx.now);
  const today = toYmd(now, ctx.timeZone);
  const nowMin = hmToMinutes(toHm(now, ctx.timeZone));
  const refs = new Set(input.map((d) => d.ref));

  return input
    .filter((d) => d.title.trim().length > 0 || d.kind === "unresolved")
    .map((raw) => {
      const d: DraftItem = structuredClone(raw);
      d.title = d.title.trim().slice(0, 200);
      if (d.date && !isYmd(d.date)) {
        d.date = null;
        addUnique(d, { field: "date", question: "באיזה יום?", blocking: d.kind === "event", options: [] });
      }
      if (d.time && !isHm(d.time)) {
        d.time = null;
        addUnique(d, { field: "time", question: "באיזו שעה?", blocking: d.kind === "event", options: [] });
      }
      if (d.notBefore && !isYmd(d.notBefore)) d.notBefore = null;
      if (d.prepForRef && !refs.has(d.prepForRef)) d.prepForRef = null;
      d.reminderMinutesBefore = [...new Set(d.reminderMinutesBefore.filter((m) => m >= 0 && m <= 60 * 24 * 14))];
      if (d.durationMin != null && (d.durationMin <= 0 || d.durationMin > 60 * 24)) d.durationMin = null;
      d.uncertainties = d.uncertainties.map((u) => ({
        ...u,
        options: u.options.filter((o) => (u.field === "time" ? isHm(o) : u.field === "date" ? isYmd(o) : o.length > 0)),
      }));

      if (d.kind === "event") {
        d.flexible = false;
        if (d.durationMin == null) {
          d.durationMin = ctx.defaultEventMin;
          d.durationIsEstimate = true;
          addUnique(d, { field: "duration", question: `כמה זמן? הנחתי ${ctx.defaultEventMin} דקות`, blocking: false, options: [] });
        }
        if (!d.time) addUnique(d, { field: "time", question: "באיזו שעה?", blocking: true, options: [] });
        if (!d.date && !d.recurrence) addUnique(d, { field: "date", question: "באיזה יום?", blocking: true, options: [today, addDaysYmd(today, 1)] });
        if (d.date && d.time && !d.recurrence) {
          const start = zonedToInstant(d.date, d.time, ctx.timeZone);
          if (start < now) {
            addUnique(d, {
              field: "date",
              question: `המועד ${formatYmdHe(d.date)} ${d.time} כבר עבר. לתקן?`,
              blocking: true,
              options: [addDaysYmd(d.date, 1), addDaysYmd(d.date, 7)],
            });
          }
        }
      }

      if (d.kind === "unresolved" && !d.question) d.question = "מה חסר כאן?";

      // Near midnight, "מחר" is easy to misread — always show the full date for checking.
      const nearMidnight = nowMin >= 23 * 60 || nowMin < 2 * 60;
      if (nearMidnight && d.date && (d.date === today || d.date === addDaysYmd(today, 1))) {
        addUnique(d, {
          field: "date",
          question: `השעה סמוכה לחצות — התכוונת ל${formatYmdHe(d.date, { withYear: true })}?`,
          blocking: false,
          options: [],
        });
      }
      return d;
    });
}

export function blockingQuestions(d: DraftItem): Uncertainty[] {
  return d.uncertainties.filter((u) => u.blocking);
}

export function isReady(d: DraftItem): boolean {
  if (blockingQuestions(d).length) return false;
  if (d.kind === "event") return Boolean(d.title && d.date && d.time);
  return Boolean(d.title || d.kind === "unresolved");
}

/** Existing events this draft would overlap — shown before confirmation. */
export function draftConflicts(state: AppState, d: DraftItem, tz: string) {
  if (d.kind !== "event" || !d.date || !d.time) return [];
  const start = zonedToInstant(d.date, d.time, tz);
  const end = new Date(start.getTime() + (d.durationMin ?? 60) * 60000);
  return conflictsWith(state, { start: start.toISOString(), end: end.toISOString() });
}

/** Turns confirmed drafts into one atomic, idempotent operation. */
export function draftsToOp(
  drafts: DraftItem[],
  opts: { opId: string; timeZone: string; now: Date; source: ItemSource; defaultTaskMin: number },
): Op {
  const { timeZone: tz, now, source } = opts;
  const iso = now.toISOString();
  const refToId = new Map<string, string>();
  for (const d of drafts) refToId.set(d.ref, newId(d.kind === "event" ? "e" : d.kind === "task" ? "t" : "u"));

  const put: Item[] = [];
  for (const d of drafts) {
    const id = refToId.get(d.ref)!;
    const recurrence = d.recurrence
      ? { freq: d.recurrence.freq, interval: Math.max(1, d.recurrence.interval), byWeekday: d.recurrence.byWeekday }
      : undefined;

    if (d.kind === "event") {
      const start = zonedToInstant(d.date!, d.time!, tz);
      const end = new Date(start.getTime() + (d.durationMin ?? 60) * 60000);
      const ev: CalendarEvent = {
        id,
        kind: "event",
        title: d.title,
        start: start.toISOString(),
        end: end.toISOString(),
        timeZone: tz,
        location: d.location ?? undefined,
        notes: d.people.length ? `עם: ${d.people.join(", ")}` : undefined,
        recurrence,
        source,
        createdAt: iso,
        updatedAt: iso,
      };
      put.push(ev);
      for (const minutes of d.reminderMinutesBefore) put.push(reminder(id, "event", minutes, iso));
    } else if (d.kind === "task") {
      let due: string | undefined;
      let dueIsDateOnly = false;
      if (d.date && d.time) due = zonedToInstant(d.date, d.time, tz).toISOString();
      else if (d.date) {
        due = zonedToInstant(addDaysYmd(d.date, 1), "00:00", tz).toISOString();
        dueIsDateOnly = true;
      }
      const task: Task = {
        id,
        kind: "task",
        title: d.title,
        status: "open",
        durationMin: d.durationMin ?? undefined,
        durationAssumed: d.durationMin == null ? undefined : d.durationIsEstimate || undefined,
        due,
        dueIsDateOnly: dueIsDateOnly || undefined,
        importance: d.importance,
        flexible: d.flexible,
        preferredWindow: d.preferredWindow ?? undefined,
        notBefore: d.notBefore ? zonedToInstant(d.notBefore, "00:00", tz).toISOString() : undefined,
        dependsOn: [],
        prepFor: d.prepForRef ? refToId.get(d.prepForRef) : undefined,
        recurrence,
        timeZone: tz,
        source,
        createdAt: iso,
        updatedAt: iso,
      };
      put.push(task);
      if (due && !dueIsDateOnly) for (const minutes of d.reminderMinutesBefore) put.push(reminder(id, "task", minutes, iso));
    } else {
      const u: Unresolved = {
        id,
        kind: "unresolved",
        text: d.sourceText || d.title,
        question: d.question ?? "מה חסר כאן?",
        createdAt: iso,
        updatedAt: iso,
      };
      put.push(u);
    }
  }
  const n = drafts.length;
  return { opId: opts.opId, label: n === 1 ? `נוסף: ${drafts[0]!.title}` : `נוספו ${n} פריטים`, source, put };
}

function reminder(targetId: string, kind: "event" | "task", minutes: number, iso: string): Reminder {
  return {
    id: newId("r"),
    kind: "reminder",
    target: { kind, id: targetId },
    rule: { type: "before", minutes },
    channel: "notification",
    state: "pending",
    createdAt: iso,
    updatedAt: iso,
  };
}
