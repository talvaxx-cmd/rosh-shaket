import { describe, expect, it } from "vitest";
import { addMissingRemindersOp, dueNotifications } from "@/lib/domain/reminders";
import { applyOp, emptyState } from "@/lib/domain/store-core";
import type { AppState, Reminder } from "@/lib/domain/types";
import { parseHebrew } from "@/lib/extraction/rules-parser";
import { autoResolve, draftsToOp, validateDrafts } from "@/lib/extraction/validate";
import { zonedToInstant } from "@/lib/time";
import { ctxAt, TZ } from "./helpers";

// Tuesday 27.10.2026, 11:00.
const ctx = ctxAt("2026-10-27", "11:00");
const at = (ymd: string, hm: string) => zonedToInstant(ymd, hm, TZ);

function save(text: string, defaultReminders: number[] = [0], state: AppState = emptyState({ timeZone: TZ })) {
  const drafts = autoResolve(validateDrafts(parseHebrew(text, ctx).items, ctx), ctx);
  return applyOp(state, draftsToOp(drafts, { opId: `s:${text}`, timeZone: TZ, now: new Date(ctx.now), source: "voice", defaultTaskMin: 30, defaultReminders })).state;
}
const reminders = (s: AppState) => Object.values(s.items).filter((i): i is Reminder => i.kind === "reminder");

describe("anything with a time rings without asking", () => {
  it("a meeting at a set time gets a reminder at that time", () => {
    const s = save("מחר בעשר בבוקר תור לרופא");
    expect(reminders(s).map((r) => r.rule)).toEqual([{ type: "before", minutes: 0 }]);
    expect(dueNotifications(s, at("2026-10-28", "09:59"))).toHaveLength(0);
    const due = dueNotifications(s, at("2026-10-28", "10:00"));
    expect(due.map((d) => d.title)).toEqual(["תור לרופא"]);
  });

  it("a reminder that was asked for replaces the default", () => {
    const s = save("מחר בעשר בבוקר תור לרופא, תזכיר לי חצי שעה לפני");
    expect(reminders(s).map((r) => r.rule)).toEqual([{ type: "before", minutes: 30 }]);
  });

  it("nothing is added to things without a time", () => {
    expect(reminders(save("לקנות חלב"))).toHaveLength(0);
    expect(reminders(save("מחר פגישה עם רונית"))).toHaveLength(0);
  });

  it("turned off in settings → no automatic reminder", () => {
    expect(reminders(save("מחר בעשר בבוקר תור לרופא", []))).toHaveLength(0);
  });

  it("a reminder at the time rings even in quiet hours", () => {
    const s = save("היום ב-23:00 לקחת תרופה");
    expect(dueNotifications(s, at("2026-10-27", "23:00")).map((d) => d.title)).toEqual(["לקחת תרופה"]);
  });

  it("items saved earlier without reminders can get them in one tap", () => {
    let s = save("מחר בעשר בבוקר תור לרופא", []);
    s = save("לקנות חלב", [], s);
    const op = addMissingRemindersOp(s, [0], new Date(ctx.now), "fill");
    expect(op.put).toHaveLength(1);
    s = applyOp(s, op).state;
    expect(addMissingRemindersOp(s, [0], new Date(ctx.now), "again").put).toHaveLength(0);
    expect(dueNotifications(s, at("2026-10-28", "10:00"))).toHaveLength(1);
  });
});
