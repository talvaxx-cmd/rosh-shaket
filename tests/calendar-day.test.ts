import { describe, expect, it } from "vitest";
import { calendarDay } from "@/lib/domain/agenda";
import { parseHebrew } from "@/lib/extraction/rules-parser";
import { draftsToOp, validateDrafts } from "@/lib/extraction/validate";
import { applyOp, emptyState } from "@/lib/domain/store-core";
import { ctxAt, TZ } from "./helpers";

const ctx = ctxAt("2026-10-27", "09:00");
function typed(text: string) {
  const drafts = validateDrafts(parseHebrew(text, ctx).items, ctx);
  drafts.forEach((d) => (d.uncertainties = d.uncertainties.filter((u) => !u.blocking)));
  return applyOp(emptyState({ timeZone: TZ }), draftsToOp(drafts, { opId: "x", timeZone: TZ, now: new Date(ctx.now), source: "text", defaultTaskMin: 30 })).state;
}

describe("what the calendar shows for a day", () => {
  it("a task with a time sits on the timeline next to meetings", () => {
    const s = typed("היום ב-15:00 פגישה עם דני, ולשלוח את הדוח עד היום ב-17:00");
    const day = calendarDay(s, "2026-10-27", TZ, "2026-10-27");
    expect(day.timeline.map((r) => [r.type, r.type === "event" ? r.occ.title : r.task.title])).toEqual([
      ["event", "פגישה עם דני"],
      ["due", "לשלוח את הדוח"],
    ]);
  });

  it("a task for a day without a time is listed for that day", () => {
    const s = typed("מחר לקנות מתנה");
    expect(calendarDay(s, "2026-10-28", TZ, "2026-10-27").allDay.map((t) => t.title)).toEqual(["לקנות מתנה"]);
    expect(calendarDay(s, "2026-10-27", TZ, "2026-10-27").allDay).toHaveLength(0);
  });

  it("a task with no date shows on today only, without inventing a date", () => {
    const s = typed("לתאם טכנאי");
    expect(calendarDay(s, "2026-10-27", TZ, "2026-10-27").undated.map((t) => t.title)).toEqual(["לתאם טכנאי"]);
    expect(calendarDay(s, "2026-10-28", TZ, "2026-10-27").undated).toHaveLength(0);
    expect((Object.values(s.items).find((i) => i.kind === "task") as { due?: string }).due).toBeUndefined();
  });
});
