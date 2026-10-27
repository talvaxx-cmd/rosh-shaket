import { describe, expect, it } from "vitest";
import { calendarDay } from "@/lib/domain/agenda";
import { applyOp, emptyState } from "@/lib/domain/store-core";
import { parseHebrew } from "@/lib/extraction/rules-parser";
import { autoResolve, draftsToOp, isReady, validateDrafts } from "@/lib/extraction/validate";
import { ctxAt, TZ } from "./helpers";

// Tuesday 27.10.2026, 11:00.
const ctx = ctxAt("2026-10-27", "11:00");
function saveSaid(text: string) {
  const drafts = autoResolve(validateDrafts(parseHebrew(text, ctx).items, ctx), ctx);
  expect(drafts.every(isReady)).toBe(true);
  const state = applyOp(emptyState({ timeZone: TZ }), draftsToOp(drafts, { opId: "s", timeZone: TZ, now: new Date(ctx.now), source: "voice", defaultTaskMin: 30 })).state;
  return { drafts, state };
}

describe("everything said goes into the calendar — no question blocks saving", () => {
  it("'פגישה בשלוש' is saved at 15:00 and marked to check", () => {
    const { drafts, state } = saveSaid("מחר פגישה בשלוש עם דני");
    expect(drafts[0]!.time).toBe("15:00");
    expect(drafts[0]!.unsure).toMatch(/15:00/);
    const day = calendarDay(state, "2026-10-28", TZ, "2026-10-27");
    expect(day.timeline).toHaveLength(1);
  });

  it("a meeting without a time still lands on its day", () => {
    const { state } = saveSaid("מחר פגישה עם רונית");
    const day = calendarDay(state, "2026-10-28", TZ, "2026-10-27");
    expect(day.allDay.map((t) => t.title)).toEqual(["פגישה עם רונית"]);
    expect(day.allDay[0]!.unsure).toMatch(/לא נאמרה שעה/);
  });

  it("a time without a day is saved on the next fitting day", () => {
    const { state } = saveSaid("שיחה עם הבנק ב-16:00");
    const day = calendarDay(state, "2026-10-27", TZ, "2026-10-27");
    expect(day.timeline.map((r) => (r.type === "event" ? r.occ.title : ""))).toEqual(["שיחה עם הבנק"]);
  });

  it("a brain dump: every item lands in the calendar", () => {
    const { state } = saveSaid("לקנות חלב, מחר בעשר תור לרופא, ולהתקשר לאמא");
    const today = calendarDay(state, "2026-10-27", TZ, "2026-10-27");
    const tomorrow = calendarDay(state, "2026-10-28", TZ, "2026-10-27");
    const titles = [...today.timeline, ...tomorrow.timeline].map((r) => (r.type === "event" ? r.occ.title : r.task.title));
    expect(titles).toContain("תור לרופא");
    expect(today.undated.map((t) => t.title)).toEqual(["לקנות חלב", "להתקשר לאמא"]);
  });
});
