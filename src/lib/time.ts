/**
 * Time-zone aware helpers built only on Intl, so the same code runs in the
 * browser, on the server and in tests.
 *
 * Conventions:
 *  - An "instant" is an ISO-8601 UTC string (Date#toISOString()).
 *  - A "ymd" is a local calendar date "YYYY-MM-DD" in some IANA zone.
 *  - An "hm" is a local wall-clock time "HH:mm".
 */

export type Ymd = string;
export type Hm = string;

const partsCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday */
  weekday: number;
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const out: Record<string, string> = {};
  for (const p of partsFormatter(timeZone).formatToParts(date)) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: WEEKDAYS.indexOf(out.weekday ?? "Sun"),
  };
}

/** Offset of `timeZone` from UTC at `date`, in minutes (local − UTC). */
export function tzOffsetMinutes(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

const pad = (n: number) => String(n).padStart(2, "0");

export function parseYmd(ymd: Ymd): { y: number; m: number; d: number } {
  const [y, m, d] = ymd.split("-").map(Number);
  return { y: y!, m: m!, d: d! };
}

export function parseHm(hm: Hm): { h: number; min: number } {
  const [h, min] = hm.split(":").map(Number);
  return { h: h!, min: min! };
}

export function isYmd(s: unknown): s is Ymd {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function isHm(s: unknown): s is Hm {
  return typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}

export function hm(h: number, min = 0): Hm {
  return `${pad(h)}:${pad(min)}`;
}

/** Wall-clock date+time in a zone → absolute instant. Handles DST gaps by rolling forward. */
export function zonedToInstant(ymd: Ymd, time: Hm, timeZone: string): Date {
  const { y, m, d } = parseYmd(ymd);
  const { h, min } = parseHm(time);
  const guess = Date.UTC(y, m - 1, d, h, min);
  let result = guess - tzOffsetMinutes(new Date(guess), timeZone) * 60000;
  // Re-check: the offset at the result may differ around DST transitions.
  const second = guess - tzOffsetMinutes(new Date(result), timeZone) * 60000;
  if (second !== result) result = Math.max(result, second);
  return new Date(result);
}

export function toYmd(date: Date, timeZone: string): Ymd {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function toHm(date: Date, timeZone: string): Hm {
  const p = zonedParts(date, timeZone);
  return hm(p.hour, p.minute);
}

export function addDaysYmd(ymd: Ymd, days: number): Ymd {
  const { y, m, d } = parseYmd(ymd);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 0 = Sunday */
export function weekdayOfYmd(ymd: Ymd): number {
  const { y, m, d } = parseYmd(ymd);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function diffDaysYmd(a: Ymd, b: Ymd): number {
  const pa = parseYmd(a);
  const pb = parseYmd(b);
  return Math.round((Date.UTC(pa.y, pa.m - 1, pa.d) - Date.UTC(pb.y, pb.m - 1, pb.d)) / 86400000);
}

/** Start of the local day as an instant. */
export function startOfDay(ymd: Ymd, timeZone: string): Date {
  return zonedToInstant(ymd, "00:00", timeZone);
}

/** Start of the following local day as an instant (end-exclusive). */
export function endOfDay(ymd: Ymd, timeZone: string): Date {
  return zonedToInstant(addDaysYmd(ymd, 1), "00:00", timeZone);
}

export function addMinutes(date: Date | string, minutes: number): Date {
  return new Date(new Date(date).getTime() + minutes * 60000);
}

export function minutesBetween(a: Date | string, b: Date | string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
}

export function hmToMinutes(t: Hm): number {
  const { h, min } = parseHm(t);
  return h * 60 + min;
}

export function minutesToHm(total: number): Hm {
  const t = ((total % 1440) + 1440) % 1440;
  return hm(Math.floor(t / 60), t % 60);
}

// ---------- Hebrew display ----------

export const HEBREW_WEEKDAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

const HEBREW_MONTHS = [
  "בינואר",
  "בפברואר",
  "במרץ",
  "באפריל",
  "במאי",
  "ביוני",
  "ביולי",
  "באוגוסט",
  "בספטמבר",
  "באוקטובר",
  "בנובמבר",
  "בדצמבר",
];

/** "יום שלישי, 28 באוקטובר 2026" */
export function formatYmdHe(ymd: Ymd, opts: { withYear?: boolean; withWeekday?: boolean } = {}): string {
  const { y, m, d } = parseYmd(ymd);
  const { withYear = false, withWeekday = true } = opts;
  const date = `${d} ${HEBREW_MONTHS[m - 1]}${withYear ? ` ${y}` : ""}`;
  return withWeekday ? `יום ${HEBREW_WEEKDAYS[weekdayOfYmd(ymd)]}, ${date}` : date;
}

/** "היום" / "מחר" / "אתמול" / full date, relative to `todayYmd`. */
export function relativeDayHe(ymd: Ymd, todayYmd: Ymd): string {
  const diff = diffDaysYmd(ymd, todayYmd);
  if (diff === 0) return "היום";
  if (diff === 1) return "מחר";
  if (diff === 2) return "מחרתיים";
  if (diff === -1) return "אתמול";
  return formatYmdHe(ymd);
}

export function formatDurationHe(minutes: number): string {
  if (minutes < 60) return minutes === 30 ? "חצי שעה" : minutes === 15 ? "רבע שעה" : `${minutes} דקות`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = h === 1 ? "שעה" : h === 2 ? "שעתיים" : `${h} שעות`;
  if (m === 0) return hours;
  if (m === 30) return `${hours} וחצי`;
  if (m === 15) return `${hours} ורבע`;
  return `${hours} ו־${m} דקות`;
}

export function defaultTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Jerusalem";
  } catch {
    return "Asia/Jerusalem";
  }
}
