import { addDaysYmd, diffDaysYmd, parseYmd, toHm, toYmd, weekdayOfYmd, zonedToInstant, type Ymd } from "../time";
import type { CalendarEvent, Recurrence } from "./types";

export interface Occurrence {
  eventId: string;
  /** Original local date of the occurrence; identifies it for per-occurrence edits. */
  key: Ymd;
  title: string;
  start: string;
  end: string;
  location?: string;
  recurring: boolean;
  moved: boolean;
}

const MAX_OCCURRENCES = 1000;

function matchesRule(rule: Recurrence, firstYmd: Ymd, candidate: Ymd): boolean {
  const days = diffDaysYmd(candidate, firstYmd);
  if (days < 0) return false;
  if (rule.until && candidate > rule.until) return false;
  const interval = Math.max(1, rule.interval || 1);
  switch (rule.freq) {
    case "daily":
      return days % interval === 0;
    case "weekly": {
      const weekdays = rule.byWeekday?.length ? rule.byWeekday : [weekdayOfYmd(firstYmd)];
      if (!weekdays.includes(weekdayOfYmd(candidate))) return false;
      // Weeks counted from the Sunday of the first occurrence's week.
      const firstSunday = addDaysYmd(firstYmd, -weekdayOfYmd(firstYmd));
      const weeks = Math.floor(diffDaysYmd(candidate, firstSunday) / 7);
      return weeks % interval === 0;
    }
    case "monthly": {
      const a = parseYmd(firstYmd);
      const b = parseYmd(candidate);
      if (a.d !== b.d) return false;
      const months = (b.y - a.y) * 12 + (b.m - a.m);
      return months % interval === 0;
    }
  }
}

/** All occurrences of `event` that overlap [rangeStart, rangeEnd). */
export function occurrencesInRange(event: CalendarEvent, rangeStart: Date, rangeEnd: Date): Occurrence[] {
  const durationMs = new Date(event.end).getTime() - new Date(event.start).getTime();
  const base = (key: Ymd, start: string, end: string): Occurrence => ({
    eventId: event.id,
    key,
    title: event.title,
    start,
    end,
    location: event.location,
    recurring: Boolean(event.recurrence),
    moved: false,
  });
  const overlaps = (o: Occurrence) =>
    new Date(o.start).getTime() < rangeEnd.getTime() && new Date(o.end).getTime() > rangeStart.getTime();

  const tz = event.timeZone;
  const firstYmd = toYmd(new Date(event.start), tz);

  if (!event.recurrence) {
    const o = base(firstYmd, event.start, event.end);
    return overlaps(o) ? [o] : [];
  }

  const startHm = toHm(new Date(event.start), tz);
  const out: Occurrence[] = [];
  // Begin a day early so occurrences that started yesterday and run into the range are found.
  let day = toYmd(new Date(rangeStart.getTime() - durationMs - 86400000), tz);
  if (day < firstYmd) day = firstYmd;
  const lastDay = toYmd(rangeEnd, tz);

  for (let i = 0; day <= lastDay && i < MAX_OCCURRENCES * 3; i++, day = addDaysYmd(day, 1)) {
    if (!matchesRule(event.recurrence, firstYmd, day)) continue;
    const override = event.overrides?.[day];
    if (override?.kind === "cancelled") continue;
    let occ: Occurrence;
    if (override?.kind === "moved") {
      occ = {
        ...base(day, override.start, override.end),
        title: override.title ?? event.title,
        location: override.location ?? event.location,
        moved: true,
      };
    } else {
      const start = zonedToInstant(day, startHm, tz);
      occ = base(day, start.toISOString(), new Date(start.getTime() + durationMs).toISOString());
    }
    if (overlaps(occ)) out.push(occ);
    if (out.length >= MAX_OCCURRENCES) break;
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

export function describeRecurrenceHe(r: Recurrence): string {
  const names = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
  const every = r.interval > 1 ? ` (כל ${r.interval})` : "";
  let text: string;
  switch (r.freq) {
    case "daily":
      text = r.interval > 1 ? `כל ${r.interval} ימים` : "כל יום";
      break;
    case "weekly":
      text = r.byWeekday?.length
        ? `כל שבוע בימי ${r.byWeekday.map((d) => names[d]).join(", ")}${every}`
        : r.interval > 1
          ? `כל ${r.interval} שבועות`
          : "כל שבוע";
      break;
    case "monthly":
      text = r.interval > 1 ? `כל ${r.interval} חודשים` : "כל חודש";
      break;
  }
  return r.until ? `${text}, עד ${r.until.split("-").reverse().join(".")}` : text;
}
