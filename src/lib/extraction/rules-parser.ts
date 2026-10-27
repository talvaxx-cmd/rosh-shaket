import { addDaysYmd, hm, toHm, toYmd, weekdayOfYmd, hmToMinutes, type Ymd } from "../time";
import { emptyDraft, type DraftItem, type ExtractionContext, type ExtractResponse, type Uncertainty } from "./draft";

/**
 * Rule-based Hebrew parser. Works offline and without an API key, and is the
 * fallback when the language model is unavailable. Deliberately conservative:
 * when something is unclear it asks instead of inventing a value.
 */

const NIQQUD = /[֑-ׇ]/g;

export function normalize(text: string): string {
  return text
    .replace(NIQQUD, "")
    .replace(/[״“”]/g, '"')
    .replace(/[׳‘’]/g, "'")
    .replace(/־/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

// Hebrew has no \b support in JS regex; these emulate word boundaries.
const B = "(?<=^|[\\s,.;:!?\"'()\\-])";
const E = "(?=$|[\\s,.;:!?\"'()\\-])";
const word = (src: string, flags = "") => new RegExp(`${B}(?:${src})${E}`, flags);

const HOUR_WORDS: [string, number][] = [
  ["אחת עשרה", 11],
  ["אחת-עשרה", 11],
  ["שתים עשרה", 12],
  ["שתים-עשרה", 12],
  ["שתיים עשרה", 12],
  ["אחת", 1],
  ["שתיים", 2],
  ["שתים", 2],
  ["שלוש", 3],
  ["ארבע", 4],
  ["חמש", 5],
  ["שש", 6],
  ["שבע", 7],
  ["שמונה", 8],
  ["תשע", 9],
  ["עשר", 10],
];
const HOUR_WORD_SRC = HOUR_WORDS.map(([w]) => w).join("|");

const NUMBER_WORDS: Record<string, number> = {
  אחת: 1, אחד: 1, שתיים: 2, שתי: 2, שניים: 2, שני: 2, שלוש: 3, שלושה: 3, ארבע: 4, ארבעה: 4, חמש: 5, חמישה: 5,
  שש: 6, שישה: 6, שבע: 7, שבעה: 7, שמונה: 8, תשע: 9, תשעה: 9, עשר: 10, עשרה: 10, רבע: 15, עשרים: 20,
  "עשרים וחמש": 25, שלושים: 30, "ארבעים וחמש": 45, ארבעים: 40, חמישים: 50,
};
const NUMBER_WORD_SRC = Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length).join("|");

const WEEKDAY_NAMES: [string, number][] = [
  ["ראשון", 0],
  ["שני", 1],
  ["שלישי", 2],
  ["רביעי", 3],
  ["חמישי", 4],
  ["שישי", 5],
  ["שבת", 6],
];
const WEEKDAY_SRC = WEEKDAY_NAMES.map(([w]) => w).join("|");

const EVENT_WORDS =
  "פגישה|פגישת|תור|ישיבה|ישיבת|שיחה|שיחת|זום|ארוחה|ארוחת|אירוע|הרצאה|שיעור|אימון|טיסה|חתונה|יום הולדת|בר מצווה|בת מצווה|ברית|ראיון|מסיבה|הופעה|הצגה|כנס|סדנה|מפגש|דייט|בדיקה אצל|טיפול|אסיפה|אסיפת";

const PLACE_WORDS =
  "משרד|בית|קפה|מרפאה|קליניקה|סניף|גן|בית הספר|בית ספר|חדר ישיבות|זום|קניון|מכון|סטודיו|מעבדה|אוניברסיטה|מכללה|בנק|דואר|עירייה";

const MONTHS: Record<string, number> = {
  ינואר: 1, פברואר: 2, מרץ: 3, מרס: 3, אפריל: 4, מאי: 5, יוני: 6, יולי: 7, אוגוסט: 8, ספטמבר: 9, אוקטובר: 10, נובמבר: 11, דצמבר: 12,
};

interface Ctx {
  today: Ymd;
  nowHm: string;
  ctx: ExtractionContext;
}

interface Found<T> {
  value: T;
  rest: string;
}

function cut(text: string, re: RegExp): { match: RegExpMatchArray | null; rest: string } {
  const match = text.match(re);
  if (!match || match.index == null) return { match: null, rest: text };
  const rest = (text.slice(0, match.index) + " " + text.slice(match.index + match[0].length)).replace(/\s+/g, " ").trim();
  return { match, rest };
}

function nextWeekday(today: Ymd, weekday: number, allowToday: boolean): Ymd {
  let diff = (weekday - weekdayOfYmd(today) + 7) % 7;
  if (diff === 0 && !allowToday) diff = 7;
  return addDaysYmd(today, diff);
}

// ---------------- dates ----------------

interface DateInfo {
  date?: Ymd;
  notBefore?: Ymd;
  /** Flexible deadline ("השבוע"). */
  dueByWeekEnd?: boolean;
  window?: DraftItem["preferredWindow"];
  uncertain?: Uncertainty;
}

function parseDate(text: string, c: Ctx): Found<DateInfo | null> {
  let r: ReturnType<typeof cut>;
  const { today } = c;

  r = cut(text, word("(?:ה)?מחרתיים"));
  if (r.match) return { value: { date: addDaysYmd(today, 2) }, rest: r.rest };

  r = cut(text, word("(?:מחר|למחר)(?:\\s+(?:בבוקר|בערב|בצהריים|בלילה))?"));
  if (r.match) {
    const w = r.match[0].includes("בבוקר") ? "morning" : r.match[0].includes("בערב") ? "evening" : r.match[0].includes("בצהריים") ? "afternoon" : undefined;
    const kept = w ? r.rest + " " + r.match[0].split(/\s+/).slice(1).join(" ") : r.rest;
    return { value: { date: addDaysYmd(today, 1) }, rest: kept.trim() };
  }

  r = cut(text, word("הערב|הלילה"));
  if (r.match) return { value: { date: today, window: "evening" }, rest: r.rest + " בערב" };

  r = cut(text, word("(?:עוד\\s+)?היום(?!\\s+(?:יום|בשבוע))"));
  if (r.match && !/סדר היום/.test(text)) return { value: { date: today }, rest: r.rest };

  r = cut(text, new RegExp(`${B}בעוד\\s+(\\d+|${NUMBER_WORD_SRC}|יומיים|שבוע|שבועיים)\\s*(ימים|יום)?${E}`));
  if (r.match) {
    const n = r.match[1]!;
    const days = n === "יומיים" ? 2 : n === "שבוע" ? 7 : n === "שבועיים" ? 14 : Number(n) || NUMBER_WORDS[n] || 0;
    if (days) return { value: { date: addDaysYmd(today, days) }, rest: r.rest };
  }

  // "ב-5.11", "ב 5/11/2026", "ה-5.11"
  r = cut(text, new RegExp(`${B}(?:ב|ה|עד ה|עד)?-?\\s?(\\d{1,2})[./](\\d{1,2})(?:[./](\\d{2,4}))?${E}`));
  if (r.match) {
    const d = Number(r.match[1]);
    const m = Number(r.match[2]);
    let y = r.match[3] ? Number(r.match[3]) : Number(today.slice(0, 4));
    if (y < 100) y += 2000;
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      let date = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      if (!r.match[3] && date < today) date = `${y + 1}${date.slice(4)}`;
      return { value: { date }, rest: r.rest };
    }
  }

  // "ב-5 בנובמבר", "חמישה בנובמבר" (digits only)
  r = cut(text, new RegExp(`${B}(?:ב|ה)?-?\\s?(\\d{1,2})\\s+(?:ב|ל)(${Object.keys(MONTHS).join("|")})${E}`));
  if (r.match) {
    const d = Number(r.match[1]);
    const m = MONTHS[r.match[2]!]!;
    let y = Number(today.slice(0, 4));
    let date = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (date < today) {
      y += 1;
      date = `${y}${date.slice(4)}`;
    }
    return { value: { date }, rest: r.rest };
  }

  // "ביום שישי", "בשישי", "יום שלישי הבא"
  r = cut(text, new RegExp(`${B}(?:ב|עד |עד יום |ל)?(?:יום\\s+)?(${WEEKDAY_SRC})(\\s+הבא|\\s+הקרוב)?${E}`));
  if (r.match && !/^כל\s/.test(text.slice(Math.max(0, (r.match.index ?? 0) - 4)))) {
    const wd = WEEKDAY_NAMES.find(([w]) => w === r.match![1])![1];
    const isToday = weekdayOfYmd(today) === wd;
    const date = nextWeekday(today, wd, false);
    const info: DateInfo = { date };
    if (isToday && !r.match[2]) {
      info.uncertain = {
        field: "date",
        question: `היום יום ${r.match[1]} — התכוונת להיום או לשבוע הבא?`,
        blocking: true,
        options: [today, date],
      };
      info.date = undefined;
    }
    return { value: info, rest: r.rest };
  }

  r = cut(text, word("(?:מתישהו\\s+)?(?:ב)?שבוע הבא"));
  if (r.match) {
    const sunday = nextWeekday(today, 0, false);
    return { value: { notBefore: sunday, date: addDaysYmd(sunday, 6), dueByWeekEnd: true }, rest: r.rest };
  }

  r = cut(text, word("(?:מתישהו\\s+)?(?:עד\\s+)?(?:סוף\\s+)?(?:ה)?שבוע(?:\\s+הזה)?|(?:מתישהו\\s+)?השבוע"));
  if (r.match) {
    const saturday = addDaysYmd(today, 6 - weekdayOfYmd(today));
    return { value: { date: saturday, dueByWeekEnd: true }, rest: r.rest };
  }

  r = cut(text, word("(?:עד\\s+)?סוף\\s+(?:ה)?חודש"));
  if (r.match) {
    const [y, m] = today.split("-").map(Number) as [number, number];
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { value: { date: `${today.slice(0, 7)}-${String(last).padStart(2, "0")}`, dueByWeekEnd: true }, rest: r.rest };
  }

  return { value: null, rest: text };
}

// ---------------- times ----------------

interface TimeInfo {
  time?: string;
  options?: string[];
  window?: DraftItem["preferredWindow"];
  approximate?: boolean;
}

type Period = "am" | "pm" | "noon" | "night" | null;

function periodOf(text: string): { period: Period; rest: string; window?: DraftItem["preferredWindow"] } {
  const tests: [RegExp, Period, DraftItem["preferredWindow"]][] = [
    [word("בבוקר|לפנות בוקר|על הבוקר"), "am", "morning"],
    [word("אחר הצהריים|אחרי הצהריים|אחה\"צ|אחהצ"), "pm", "afternoon"],
    [word("בצהריים|צהריים"), "noon", "afternoon"],
    [word("בערב|לפנות ערב"), "pm", "evening"],
    [word("בלילה"), "night", "evening"],
  ];
  for (const [re, p, w] of tests) {
    const r = cut(text, re);
    if (r.match) return { period: p, rest: r.rest, window: w };
  }
  return { period: null, rest: text };
}

function resolveHour(h: number, period: Period): number[] {
  if (h >= 13) return [h];
  switch (period) {
    case "am":
      return [h === 12 ? 0 : h];
    case "pm":
      return [h === 12 ? 12 : h + 12];
    case "noon":
      return [h === 12 ? 12 : h <= 5 ? h + 12 : h];
    case "night":
      return [h <= 4 ? h : h === 12 ? 0 : h + 12];
    default:
      if (h === 12) return [12];
      // No context: both readings, most plausible first. The user decides.
      return h <= 7 ? [h + 12, h] : [h, h + 12];
  }
}

function parseTime(text: string): Found<TimeInfo | null> {
  const p = periodOf(text);
  let rest = p.rest;
  let r: ReturnType<typeof cut>;

  // "ב-15:30", "בשעה 9", "ב 9:15"
  r = cut(rest, new RegExp(`${B}(?:בסביבות|בערך ב|בשעה|ב-?|ב\\s|עד השעה|עד)\\s*(\\d{1,2})(?::(\\d{2}))?(\\s+וחצי|\\s+ורבע)?${E}`));
  if (r.match) {
    const raw = r.match[1]!;
    const h = Number(raw);
    let min = r.match[2] ? Number(r.match[2]) : 0;
    if (r.match[3]?.includes("וחצי")) min = 30;
    if (r.match[3]?.includes("ורבע")) min = 15;
    if (h <= 24 && min < 60) {
      const approx = /בסביבות|בערך/.test(r.match[0]);
      // Leading zero ("09:00") or 24h ("15:00") is explicit.
      const explicit = raw.length === 2 && raw.startsWith("0");
      const hours = explicit ? [h] : resolveHour(h % 24, p.period);
      const options = hours.map((x) => hm(x, min));
      return {
        value: options.length === 1 ? { time: options[0], window: p.window, approximate: approx } : { options, window: p.window, approximate: approx },
        rest: r.rest,
      };
    }
  }

  // "ברבע לחמש"
  r = cut(rest, new RegExp(`${B}(?:ב)?רבע ל(${HOUR_WORD_SRC})${E}`));
  if (r.match) {
    const h = HOUR_WORDS.find(([w]) => w === r.match![1])![1];
    const hours = resolveHour(h, p.period).map((x) => (x + 23) % 24);
    const options = hours.map((x) => hm(x, 45));
    return { value: options.length === 1 ? { time: options[0], window: p.window } : { options, window: p.window }, rest: r.rest };
  }

  // "בשלוש", "בשעה שלוש וחצי", "בסביבות ארבע"
  r = cut(rest, new RegExp(`${B}(?:בשעה\\s+|בסביבות\\s+|ב)(${HOUR_WORD_SRC})(\\s+וחצי|\\s+ורבע|\\s+בדיוק)?${E}`));
  if (r.match) {
    const h = HOUR_WORDS.find(([w]) => w === r.match![1])![1];
    const min = r.match[2]?.includes("וחצי") ? 30 : r.match[2]?.includes("ורבע") ? 15 : 0;
    const options = resolveHour(h, p.period).map((x) => hm(x, min));
    const approx = /בסביבות/.test(r.match[0]);
    return {
      value: options.length === 1 ? { time: options[0], window: p.window, approximate: approx } : { options, window: p.window, approximate: approx },
      rest: r.rest,
    };
  }

  r = cut(rest, word("בצהריים"));
  if (r.match) rest = r.rest;
  if (p.window) return { value: { window: p.window }, rest };
  return { value: null, rest: text };
}

// ---------------- durations & reminders ----------------

function minutesFromPhrase(phrase: string): number | null {
  const s = phrase.trim();
  if (/^רבע שעה$/.test(s)) return 15;
  if (/^חצי שעה$/.test(s)) return 30;
  if (/^שעה וחצי$/.test(s)) return 90;
  if (/^שעה ורבע$/.test(s)) return 75;
  if (/^שעה$/.test(s)) return 60;
  if (/^שעתיים$/.test(s)) return 120;
  if (/^שעתיים וחצי$/.test(s)) return 150;
  if (/^יום$/.test(s)) return 1440;
  if (/^יומיים$/.test(s)) return 2880;
  if (/^שבוע$/.test(s)) return 10080;
  let m = s.match(new RegExp(`^(\\d+|${NUMBER_WORD_SRC})\\s+(דקות|דק'|שעות|ימים)$`));
  if (m) {
    const n = Number(m[1]) || NUMBER_WORDS[m[1]!] || 0;
    return m[2]!.startsWith("ד") ? n : m[2] === "שעות" ? n * 60 : n * 1440;
  }
  m = s.match(/^(\d+)\s*(?:דק|ד')$/);
  if (m) return Number(m[1]);
  return null;
}

const DURATION_SRC = `(?:\\d+|${NUMBER_WORD_SRC})\\s+(?:דקות|דק'|שעות|ימים)|רבע שעה|חצי שעה|שעתיים וחצי|שעה וחצי|שעה ורבע|שעתיים|שעה|יומיים|יום|שבוע`;

function parseReminders(text: string): Found<number[]> {
  const out: number[] = [];
  let rest = text;
  const re = new RegExp(`${B}(${DURATION_SRC})\\s+(?:לפני|מראש|קודם)${E}`);
  for (let i = 0; i < 4; i++) {
    const r = cut(rest, re);
    if (!r.match) break;
    const mins = minutesFromPhrase(r.match[1]!);
    if (mins != null) out.push(mins);
    rest = r.rest;
  }
  const atTime = cut(rest, word("בזמן|באותו רגע|בדיוק בזמן"));
  if (atTime.match && /תזכיר|תזכורת/.test(text)) {
    out.push(0);
    rest = atTime.rest;
  }
  const evening = cut(rest, word("ערב לפני|יום קודם|יום לפני"));
  if (evening.match) {
    out.push(1440);
    rest = evening.rest;
  }
  return { value: out, rest };
}

function parseDuration(text: string): Found<{ minutes: number; estimate: boolean } | null> {
  const approx = new RegExp(`${B}(?:בערך|משהו כמו|בסביבות|כ-?|לערך|פחות או יותר)${E}`);
  const re = new RegExp(`${B}(?:למשך\\s+|של\\s+|תוך\\s+)?(${DURATION_SRC})(?:\\s+(?:בערך|לערך|פחות או יותר))?${E}`);
  const r = cut(text, re);
  if (!r.match) return { value: null, rest: text };
  const mins = minutesFromPhrase(r.match[1]!);
  if (mins == null || mins >= 1440) return { value: null, rest: text };
  const estimate = approx.test(text) || /בערך|לערך|פחות או יותר/.test(r.match[0]);
  return { value: { minutes: mins, estimate }, rest: r.rest.replace(approx, " ").replace(/\s+/g, " ").trim() };
}

// ---------------- recurrence ----------------

function parseRecurrence(text: string): Found<DraftItem["recurrence"]> {
  let r = cut(text, new RegExp(`${B}כל\\s+(?:יום\\s+)?(${WEEKDAY_SRC})(?:\\s+ו(?:ב)?(?:יום\\s+)?(${WEEKDAY_SRC}))?${E}`));
  if (r.match) {
    const days = [r.match[1], r.match[2]].filter(Boolean).map((n) => WEEKDAY_NAMES.find(([w]) => w === n)![1]);
    return { value: { freq: "weekly", interval: 1, byWeekday: days }, rest: r.rest };
  }
  r = cut(text, word("כל יום|כל בוקר|כל ערב|מדי יום|יום יום"));
  if (r.match) {
    const extra = r.match[0].includes("בוקר") ? " בבוקר" : r.match[0].includes("ערב") ? " בערב" : "";
    return { value: { freq: "daily", interval: 1, byWeekday: [] }, rest: r.rest + extra };
  }
  r = cut(text, word("כל יומיים"));
  if (r.match) return { value: { freq: "daily", interval: 2, byWeekday: [] }, rest: r.rest };
  r = cut(text, word("כל שבוע|מדי שבוע|פעם בשבוע"));
  if (r.match) return { value: { freq: "weekly", interval: 1, byWeekday: [] }, rest: r.rest };
  r = cut(text, word("כל שבועיים"));
  if (r.match) return { value: { freq: "weekly", interval: 2, byWeekday: [] }, rest: r.rest };
  r = cut(text, word("כל חודש|מדי חודש|פעם בחודש"));
  if (r.match) return { value: { freq: "monthly", interval: 1, byWeekday: [] }, rest: r.rest };
  return { value: null, rest: text };
}

// ---------------- titles ----------------

const FILLERS = [
  "אני צריך", "אני צריכה", "אני חייב", "אני חייבת", "צריך", "צריכה", "צריכים", "חייב", "חייבת", "לא לשכוח", "אל תשכח",
  "תזכיר לי", "תזכירי לי", "תזכורת", "תוסיף לי", "תוסיפי", "תוסיף", "תרשום", "תרשמי", "תכניס", "תכניסי", "תקבע", "תקבעי",
  "יש לי", "קבעתי", "נקבעה", "נקבע", "בבקשה", "גם", "ואז", "ואחר כך", "אחר כך", "ועוד", "עוד", "ש",
];

function cleanTitle(text: string): string {
  let t = ` ${text} `;
  for (let i = 0; i < 3; i++) {
    for (const f of FILLERS) t = t.replace(new RegExp(`^\\s*ו?${f}\\s+`), " ");
  }
  t = t
    .replace(word("דחוף|חשוב מאוד|חשוב|בדחיפות", "g"), " ")
    .replace(/\s+(?:לי|על זה|את זה|עד|ב|ל)\s*$/, " ")
    .replace(/^\s*(?:ו|ש)(?=ל[א-ת])/, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,.\-:]+|[\s,.\-:]+$/g, "")
    .trim();
  return t;
}

// ---------------- main ----------------

function splitClauses(text: string): string[] {
  return text
    .split(/(?<!\d)\.|\.(?!\d)|[!?;\n]+|,\s*|\s+(?=ו?(?:תזכיר|תזכירי|תוסיף|תוסיפי|גם|ואחר כך|ואז)\s)|\s+ו(?=ל[א-ת]{2,}\s)/)
    .map((s) => s?.trim())
    .filter((s): s is string => Boolean(s && s.replace(/[\s,.]/g, "").length));
}

function isOnlyDuration(clause: string): boolean {
  const d = parseDuration(clause);
  return d.value != null && cleanTitle(d.rest.replace(word("בערך|לערך|זה|תיקח|ייקח|יקח|לוקח|זה ייקח|תימשך|נמשך"), "")).length === 0;
}

export function parseHebrew(input: string, ctx: ExtractionContext): ExtractResponse {
  const now = new Date(ctx.now);
  const c: Ctx = { today: toYmd(now, ctx.timeZone), nowHm: toHm(now, ctx.timeZone), ctx };
  const text = normalize(input);
  const items: DraftItem[] = [];
  let refN = 0;

  for (const clause of splitClauses(text)) {
    const last = items[items.length - 1];

    // "שעה בערך" right after an event → that event's duration.
    if (last && isOnlyDuration(clause)) {
      const d = parseDuration(clause).value!;
      last.durationMin = d.minutes;
      last.durationIsEstimate = d.estimate;
      last.sourceText += `, ${clause}`;
      last.uncertainties = last.uncertainties.filter((u) => u.field !== "duration");
      continue;
    }

    const rem = parseReminders(clause);
    const isReminderClause = /תזכיר|תזכורת|להזכיר/.test(clause);
    if (isReminderClause && rem.value.length && last && cleanTitle(rem.rest).replace(/^(?:לי|על זה|את זה|לפני)$/, "").length === 0) {
      last.reminderMinutesBefore.push(...rem.value);
      last.sourceText += `, ${clause}`;
      continue;
    }

    const ref = `r${++refN}`;
    let rest = rem.rest;
    const rec = parseRecurrence(rest);
    rest = rec.rest;
    const date = parseDate(rest, c);
    rest = date.rest;
    const time = parseTime(rest);
    rest = time.rest;
    const dur = parseDuration(rest);
    rest = dur.rest;

    let location: string | null = null;
    const loc = cut(rest, new RegExp(`${B}(ב(?:${PLACE_WORDS}))(?:\\s+של\\s+\\S+)?${E}`));
    if (loc.match) {
      location = loc.match[0].trim();
      rest = loc.rest;
    }
    const important = word("דחוף|חשוב מאוד|חשוב|בדחיפות").test(rest);

    const title = cleanTitle(rest);
    if (!title) continue;

    const startsWithInfinitive = /^(?:ו)?ל[א-ת]{2,}/.test(title) || /^(?:לא לשכוח|לזכור)/.test(title);
    const eventLike = new RegExp(`${B}(?:${EVENT_WORDS})`).test(title);
    const hasTime = Boolean(time.value?.time || time.value?.options);
    const kind: DraftItem["kind"] = startsWithInfinitive ? "task" : eventLike || (hasTime && !date.value?.dueByWeekEnd) ? "event" : "task";

    const d = emptyDraft(ref, kind, clause);
    d.title = title;
    d.location = location;
    d.importance = important ? "high" : "normal";
    d.reminderMinutesBefore = rem.value;
    if (rec.value) d.recurrence = rec.value;
    if (time.value?.window) d.preferredWindow = time.value.window;
    if (date.value?.window) d.preferredWindow = date.value.window;

    // Date only when said for this item — never borrowed from a neighbour (prep tasks
    // get their meeting's date below).
    let ymd = date.value?.date ?? null;
    if (date.value?.uncertain) d.uncertainties.push(date.value.uncertain);
    if (date.value?.notBefore) d.notBefore = date.value.notBefore;

    if (kind === "event") {
      d.flexible = false;
      if (dur.value) {
        d.durationMin = dur.value.minutes;
        d.durationIsEstimate = dur.value.estimate;
      } else {
        d.durationMin = ctx.defaultEventMin;
        d.durationIsEstimate = true;
        d.uncertainties.push({ field: "duration", question: `כמה זמן? הנחתי ${ctx.defaultEventMin} דקות`, blocking: false, options: [] });
      }
      if (time.value?.time) {
        d.time = time.value.time;
      } else if (time.value?.options) {
        d.uncertainties.push({
          field: "time",
          question: `באיזו שעה בדיוק — ${time.value.options.join(" או ")}?`,
          blocking: true,
          options: time.value.options,
        });
      } else {
        d.uncertainties.push({ field: "time", question: "באיזו שעה?", blocking: true, options: [] });
      }
      if (!ymd && !rec.value && !date.value?.uncertain) {
        // A time without a date: offer today (if still ahead) or tomorrow — never assume silently.
        const t = d.time ?? time.value?.options?.[0];
        const tomorrow = addDaysYmd(c.today, 1);
        const opts = t && hmToMinutes(t) > hmToMinutes(c.nowHm) ? [c.today, tomorrow] : [tomorrow, c.today];
        d.uncertainties.push({ field: "date", question: "באיזה יום?", blocking: true, options: opts });
      }
      if (!ymd && rec.value) ymd = rec.value.byWeekday.length ? nextWeekday(c.today, rec.value.byWeekday[0]!, true) : c.today;
      d.date = ymd;
    } else {
      d.flexible = true;
      d.date = ymd;
      if (time.value?.time) d.time = time.value.time;
      else if (time.value?.options) {
        d.uncertainties.push({ field: "time", question: `עד איזו שעה — ${time.value.options.join(" או ")}?`, blocking: true, options: time.value.options });
      }
      if (dur.value) {
        d.durationMin = dur.value.minutes;
        d.durationIsEstimate = dur.value.estimate;
      }
      if (!ymd && !rec.value && !d.time) {
        d.uncertainties.push({ field: "due", question: "יש מועד? אפשר גם לשמור בלי תאריך", blocking: false, options: [] });
      }
      // "להכין את ההצעה" after a meeting in the same breath → preparation for it.
      const prevEvent = [...items].reverse().find((i) => i.kind === "event");
      if (prevEvent && /^(?:ל)?(?:הכין|להכין|הכנה|הכנת|לשלוח|להדפיס|לקרוא|לעבור על)/.test(title)) {
        d.prepForRef = prevEvent.ref;
        if (!d.date) d.date = prevEvent.date;
      }
    }

    const nameMatch = title.match(/עם\s+([א-ת]{2,})/);
    if (nameMatch) d.people = [nameMatch[1]!];

    items.push(d);
  }

  return {
    mode: "rules",
    items,
    note: items.length ? null : "לא זיהיתי פריט. אפשר לנסח מחדש או להקליד.",
  };
}
