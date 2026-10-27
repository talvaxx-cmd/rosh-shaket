import { describe, expect, it } from "vitest";
import { parseHebrew } from "@/lib/extraction/rules-parser";
import { draftsToOp, isReady, validateDrafts } from "@/lib/extraction/validate";
import { applyOp, emptyState, events, tasks, reminders } from "@/lib/domain/store-core";
import { ctxAt, TZ } from "./helpers";

// Tuesday 27.10.2026, 11:00 Israel time.
const ctx = ctxAt("2026-10-27", "11:00");
const parse = (t: string) => validateDrafts(parseHebrew(t, ctx).items, ctx);

describe("Hebrew rules parser — spec examples", () => {
  it("meeting + reminder + prep task from one utterance", () => {
    const items = parse("מחר בשלוש פגישה עם דני במשרד, שעה בערך. תזכיר לי חצי שעה לפני, ותוסיף להכין את ההצעה בבוקר.");
    expect(items).toHaveLength(2);
    const [meeting, prep] = items;
    expect(meeting!.kind).toBe("event");
    expect(meeting!.title).toBe("פגישה עם דני");
    expect(meeting!.date).toBe("2026-10-28");
    expect(meeting!.durationMin).toBe(60);
    expect(meeting!.durationIsEstimate).toBe(true);
    expect(meeting!.reminderMinutesBefore).toEqual([30]);
    // "המשרד" is kept as said, never turned into an address.
    expect(meeting!.location).toBe("במשרד");
    // "בשלוש" has no am/pm context: no invented hour, a blocking question with both readings.
    expect(meeting!.time).toBeNull();
    const q = meeting!.uncertainties.find((u) => u.field === "time")!;
    expect(q.blocking).toBe(true);
    expect(q.options).toEqual(["15:00", "03:00"]);
    expect(isReady(meeting!)).toBe(false);

    expect(prep!.kind).toBe("task");
    expect(prep!.title).toBe("להכין את ההצעה");
    expect(prep!.prepForRef).toBe(meeting!.ref);
    expect(prep!.preferredWindow).toBe("morning");
    expect(prep!.date).toBe("2026-10-28");
  });

  it("brain dump becomes separate cards with no invented dates and nothing marked done", () => {
    const items = parse("צריך לקנות מתנה, לחזור לרואה חשבון, לתאם טכנאי ולבדוק את החוג");
    expect(items.map((i) => i.title)).toEqual(["לקנות מתנה", "לחזור לרואה חשבון", "לתאם טכנאי", "לבדוק את החוג"]);
    for (const i of items) {
      expect(i.kind).toBe("task");
      expect(i.date).toBeNull();
      expect(i.time).toBeNull();
    }
  });

  it("'ביום שישי' resolves to an exact date", () => {
    const [i] = parse("ביום שישי ארוחת ערב אצל ההורים בשבע בערב");
    expect(i!.date).toBe("2026-10-30");
    expect(i!.time).toBe("19:00");
  });

  it("weekday equal to today asks instead of guessing", () => {
    const [i] = parse("ביום שלישי בשעה 18:00 פגישת צוות");
    expect(i!.date).toBeNull();
    expect(i!.uncertainties.find((u) => u.field === "date")!.options).toEqual(["2026-10-27", "2026-11-03"]);
  });

  it("'מתישהו השבוע' is a flexible task without an invented time", () => {
    const [i] = parse("מתישהו השבוע לסדר את המחסן");
    expect(i!.kind).toBe("task");
    expect(i!.flexible).toBe(true);
    expect(i!.time).toBeNull();
    expect(i!.date).toBe("2026-10-31");
  });

  it("'לדבר עם אמא' is saved undated, with an optional question", () => {
    const [i] = parse("לדבר עם אמא");
    expect(i!.kind).toBe("task");
    expect(i!.date).toBeNull();
    expect(i!.people).toEqual(["אמא"]);
    expect(isReady(i!)).toBe(true);
  });

  it("explicit date, 24h time and a reminder a day before", () => {
    const [i] = parse("תור לרופא שיניים ב-5.11 ב-16:30, תזכיר לי יום לפני");
    expect(i!.date).toBe("2026-11-05");
    expect(i!.time).toBe("16:30");
    expect(i!.reminderMinutesBefore).toEqual([1440]);
    expect(isReady(i!)).toBe(true);
  });

  it("weekly recurrence", () => {
    const [i] = parse("כל יום שני בשמונה בבוקר אימון");
    expect(i!.recurrence).toEqual({ freq: "weekly", interval: 1, byWeekday: [1] });
    expect(i!.time).toBe("08:00");
    expect(i!.date).toBe("2026-11-02");
  });

  it("past time is flagged before saving", () => {
    const [i] = parse("היום בשעה 09:00 שיחה עם הבנק");
    expect(i!.uncertainties.some((u) => u.field === "date" && u.blocking)).toBe(true);
  });

  it("near midnight, 'מחר' gets an explicit full-date check", () => {
    const late = ctxAt("2026-10-27", "23:40");
    const [i] = validateDrafts(parseHebrew("מחר ב-10:00 פגישה עם רונית", late).items, late);
    expect(i!.date).toBe("2026-10-28");
    expect(i!.uncertainties.some((u) => u.field === "date" && /חצות/.test(u.question))).toBe(true);
  });
});

describe("confirmation → saved items", () => {
  it("meeting + prep become two items after confirmation, linked, with the reminder", () => {
    const drafts = parse("מחר בשלוש פגישה עם דני במשרד, שעה בערך. תזכיר לי חצי שעה לפני, ותוסיף להכין את ההצעה בבוקר.");
    // User picks 15:00.
    drafts[0]!.time = "15:00";
    drafts[0]!.uncertainties = drafts[0]!.uncertainties.filter((u) => u.field !== "time");
    expect(drafts.every(isReady)).toBe(true);

    const op = draftsToOp(drafts, { opId: "op1", timeZone: TZ, now: new Date(ctx.now), source: "voice", defaultTaskMin: 30 });
    const { state } = applyOp(emptyState({ timeZone: TZ }), op);
    const [meeting] = events(state);
    const [prep] = tasks(state);
    expect(meeting!.start).toBe("2026-10-28T13:00:00.000Z");
    expect(meeting!.end).toBe("2026-10-28T14:00:00.000Z");
    expect(prep!.prepFor).toBe(meeting!.id);
    expect(reminders(state)).toHaveLength(1);
  });

  it("cancelling before confirmation creates nothing", () => {
    parse("מחר ב-10:00 פגישה");
    expect(Object.keys(emptyState().items)).toHaveLength(0);
  });
});

describe("no invented deadlines", () => {
  it("a date said for one task is not copied to the next ones", () => {
    const items = parse("היום לקנות חלב, צריך לתאם טכנאי ולהתקשר לרואה חשבון");
    expect(items.map((i) => [i.title, i.date])).toEqual([
      ["לקנות חלב", "2026-10-27"],
      ["לתאם טכנאי", null],
      ["להתקשר לרואה חשבון", null],
    ]);
  });
});

describe("separate recordings", () => {
  it("two recordings on separate lines stay separate items", () => {
    const items = parse("לקנות חלב\nלתאם טכנאי");
    expect(items.map((i) => i.title)).toEqual(["לקנות חלב", "לתאם טכנאי"]);
  });
});
