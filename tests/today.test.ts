import { describe, expect, it } from "vitest";
import { todayTasks, unscheduledDueOn } from "@/lib/domain/agenda";
import { applyOp, emptyState } from "@/lib/domain/store-core";
import { parseHebrew } from "@/lib/extraction/rules-parser";
import { draftsToOp, validateDrafts } from "@/lib/extraction/validate";
import { ctxAt, TZ, at } from "./helpers";

const ctx = ctxAt("2026-10-28", "11:00");

function saveSpoken(text: string) {
  const drafts = validateDrafts(parseHebrew(text, ctx).items, ctx);
  const op = draftsToOp(drafts, { opId: "s", timeZone: TZ, now: new Date(ctx.now), source: "voice", defaultTaskMin: 30 });
  return applyOp(emptyState({ timeZone: TZ }), op).state;
}

describe("tasks said by voice show up on the Today screen", () => {
  it("a task for today (date, no time) counts as due today, not tomorrow", () => {
    const s = saveSpoken("היום לקנות חלב");
    expect(unscheduledDueOn(s, "2026-10-28", TZ).map((t) => t.title)).toEqual(["לקנות חלב"]);
    expect(unscheduledDueOn(s, "2026-10-29", TZ)).toHaveLength(0);
  });

  it("undated tasks are listed on Today too", () => {
    const s = saveSpoken("צריך לקנות מתנה ולתאם טכנאי");
    const t = todayTasks(s, "2026-10-28", TZ, at("2026-10-28", "11:00"));
    expect(t.undated.map((x) => x.title)).toEqual(["לקנות מתנה", "לתאם טכנאי"]);
  });

  it("tasks due later are not listed as today's", () => {
    const s = saveSpoken("ביום שישי לסדר את המחסן");
    const t = todayTasks(s, "2026-10-28", TZ, at("2026-10-28", "11:00"));
    expect(t.dueToday).toHaveLength(0);
    expect(t.undated).toHaveLength(0);
  });
});
