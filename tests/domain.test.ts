import { describe, expect, it } from "vitest";
import { findConflicts, agendaForDay } from "@/lib/domain/agenda";
import { applyReplanOp, replanAfterDisruption, applyPlanOp } from "@/lib/domain/disruption";
import { planDay } from "@/lib/domain/planner";
import { occurrencesInRange } from "@/lib/domain/recurrence";
import { dueNotifications, snoozeOp, markShownOp, afterQuietHours } from "@/lib/domain/reminders";
import { applyOp, deleteItemOp, editRecurringEventOp, undoOp, events, cancelOccurrenceOp } from "@/lib/domain/store-core";
import type { CalendarEvent, Reminder } from "@/lib/domain/types";
import { draftConflicts } from "@/lib/extraction/validate";
import { emptyDraft } from "@/lib/extraction/draft";
import { toHm } from "@/lib/time";
import { at, ev, stateWith, task, TZ } from "./helpers";

const DAY = "2026-10-28";

describe("idempotent saves and undo", () => {
  it("retrying the same save does not duplicate", () => {
    const s0 = stateWith([]);
    const op = { opId: "save-1", label: "x", source: "voice" as const, put: [ev("a", DAY, "10:00", "11:00")] };
    const s1 = applyOp(s0, op).state;
    const retry = applyOp(s1, { ...op, put: [ev("a2", DAY, "10:00", "11:00")] });
    expect(retry.applied).toBe(false);
    expect(events(retry.state)).toHaveLength(1);
  });

  it("undo restores the previous state, including cascaded reminders", () => {
    const r: Reminder = {
      id: "r1", kind: "reminder", target: { kind: "event", id: "a" }, rule: { type: "before", minutes: 30 },
      channel: "notification", state: "pending", createdAt: "x", updatedAt: "x",
    };
    let s = stateWith([ev("a", DAY, "10:00", "11:00")]);
    s = applyOp(s, { opId: "r", label: "r", source: "manual", put: [r] }).state;
    s = applyOp(s, deleteItemOp(s, "a", "del", new Date())).state;
    expect(s.items.a).toBeUndefined();
    expect(s.items.r1).toBeUndefined();
    const u = undoOp(s, "del", "undo-del");
    expect(u.ok).toBe(true);
    if (u.ok) {
      expect(u.state.items.a).toBeDefined();
      expect(u.state.items.r1).toBeDefined();
    }
  });

  it("undo refuses to silently discard a later edit", () => {
    let s = stateWith([]);
    s = applyOp(s, { opId: "add", label: "a", source: "manual", put: [ev("a", DAY, "10:00", "11:00")] }).state;
    s = applyOp(s, { opId: "edit", label: "e", source: "manual", put: [{ ...(s.items.a as CalendarEvent), title: "חדש", updatedAt: "later" }] }).state;
    const u = undoOp(s, "add", "undo-add");
    expect(u.ok).toBe(false);
  });
});

describe("conflicts", () => {
  it("overlapping events are detected", () => {
    const s = stateWith([ev("a", DAY, "10:00", "11:00"), ev("b", DAY, "10:30", "11:30"), ev("c", DAY, "11:30", "12:00")]);
    const c = findConflicts(s, at(DAY, "00:00"), at("2026-10-29", "00:00"));
    expect(c).toHaveLength(1);
    expect([c[0]!.a.id, c[0]!.b.id].sort()).toEqual(["a", "b"]);
  });

  it("a draft that collides is flagged before confirmation", () => {
    const s = stateWith([ev("a", DAY, "15:00", "16:00")]);
    const d = { ...emptyDraft("r1", "event", ""), title: "x", date: DAY, time: "15:30", durationMin: 30 };
    expect(draftConflicts(s, d, TZ).map((o) => o.eventId)).toEqual(["a"]);
  });
});

describe("recurrence", () => {
  const weekly = ev("w", "2026-11-02", "08:00", "09:00", { recurrence: { freq: "weekly", interval: 1, byWeekday: [1] } });

  it("expands weekly occurrences", () => {
    const occ = occurrencesInRange(weekly, at("2026-11-01", "00:00"), at("2026-11-30", "00:00"));
    expect(occ.map((o) => o.key)).toEqual(["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23"]);
  });

  it("editing one occurrence does not change the series", () => {
    const s = stateWith([weekly]);
    const occStart = at("2026-11-09", "08:00").toISOString();
    const op = editRecurringEventOp(weekly, "2026-11-09", occStart, { start: at("2026-11-09", "10:00").toISOString() }, "this", "e1", new Date());
    const s2 = applyOp(s, op).state;
    const occ = occurrencesInRange(s2.items.w as CalendarEvent, at("2026-11-01", "00:00"), at("2026-11-17", "00:00"));
    expect(occ.map((o) => toHm(new Date(o.start), TZ))).toEqual(["08:00", "10:00", "08:00"]);
  });

  it("'this and following' splits the series", () => {
    const s = stateWith([weekly]);
    const occStart = at("2026-11-16", "08:00").toISOString();
    const op = editRecurringEventOp(weekly, "2026-11-16", occStart, { start: at("2026-11-16", "09:00").toISOString() }, "following", "e2", new Date());
    const s2 = applyOp(s, op).state;
    const all = events(s2).flatMap((e) => occurrencesInRange(e, at("2026-11-01", "00:00"), at("2026-11-30", "00:00")));
    expect(all.map((o) => `${o.key} ${toHm(new Date(o.start), TZ)}`).sort()).toEqual([
      "2026-11-02 08:00", "2026-11-09 08:00", "2026-11-16 09:00", "2026-11-23 09:00",
    ]);
  });

  it("cancelling one occurrence keeps the others", () => {
    const s = stateWith([weekly]);
    const s2 = applyOp(s, cancelOccurrenceOp(s, weekly, "2026-11-09", "this", "c1", new Date())).state;
    const occ = occurrencesInRange(s2.items.w as CalendarEvent, at("2026-11-01", "00:00"), at("2026-11-17", "00:00"));
    expect(occ.map((o) => o.key)).toEqual(["2026-11-02", "2026-11-16"]);
  });
});

describe("daily planner", () => {
  const now = at(DAY, "07:00");

  it("places tasks only in free windows and never moves fixed events", () => {
    const s = stateWith([ev("m", DAY, "09:00", "12:00"), task("t1", { durationMin: 60 }), task("t2", { durationMin: 30 })]);
    const plan = planDay(s, DAY, { now });
    expect(plan.overloaded).toBe(false);
    for (const p of plan.placements) {
      const overlapsMeeting = new Date(p.start) < at(DAY, "12:00") && new Date(p.end) > at(DAY, "09:00");
      expect(overlapsMeeting).toBe(false);
    }
    expect(s.items.m).toEqual(stateWith([ev("m", DAY, "09:00", "12:00")]).items.m);
    expect(plan.placements[0]!.reason).toMatch(/שובץ/);
  });

  it("respects deadlines and dependencies", () => {
    const s = stateWith([
      task("b", { durationMin: 30, dependsOn: ["a"] }),
      task("a", { durationMin: 30 }),
      task("urgent", { durationMin: 30, due: at(DAY, "09:00").toISOString() }),
    ]);
    const plan = planDay(s, DAY, { now });
    const byId = Object.fromEntries(plan.placements.map((p) => [p.taskId, p]));
    expect(new Date(byId.urgent!.end) <= at(DAY, "09:00")).toBe(true);
    expect(new Date(byId.b!.start) >= new Date(byId.a!.end)).toBe(true);
  });

  it("prep task lands before its meeting", () => {
    const s = stateWith([ev("m", DAY, "15:00", "16:00"), task("prep", { durationMin: 45, prepFor: "m", preferredWindow: "morning" })]);
    const plan = planDay(s, DAY, { now });
    expect(new Date(plan.placements[0]!.end) <= at(DAY, "15:00")).toBe(true);
    expect(plan.placements[0]!.reason).toMatch(/לפני הפגישה/);
  });

  it("shows overload instead of an impossible plan", () => {
    const s = stateWith(
      [ev("m", DAY, "08:00", "19:00"), task("big", { durationMin: 180, due: at(DAY, "20:00").toISOString() })],
    );
    const plan = planDay(s, DAY, { now });
    expect(plan.placements).toHaveLength(0);
    expect(plan.overloaded).toBe(true);
    expect(plan.unplaced[0]!.taskId).toBe("big");
  });

  it("producing a plan changes nothing until it is applied", () => {
    const s = stateWith([task("t", { durationMin: 30 })]);
    const plan = planDay(s, DAY, { now });
    expect((s.items.t as { scheduled?: unknown }).scheduled).toBeUndefined();
    const s2 = applyOp(s, applyPlanOp(s, plan.placements, "plan", new Date())).state;
    expect(agendaForDay(s2, DAY, TZ).some((e) => e.type === "task")).toBe(true);
  });
});

describe("'היום השתבש'", () => {
  it("late start moves tasks later and shows the diff; events stay", () => {
    const slot = (h: string, e: string) => ({ start: at(DAY, h).toISOString(), end: at(DAY, e).toISOString() });
    const s = stateWith([
      ev("m", DAY, "13:00", "14:00"),
      task("t1", { durationMin: 60, scheduled: slot("08:00", "09:00") }),
      task("t2", { durationMin: 60, scheduled: slot("09:00", "10:00"), due: at(DAY, "12:00").toISOString() }),
    ]);
    const diff = replanAfterDisruption(s, DAY, [{ type: "lateStart", until: at(DAY, "10:00").toISOString() }], at(DAY, "07:30"));
    const moved = Object.fromEntries(diff.moved.map((m) => [m.taskId, m]));
    expect(new Date(moved.t2!.start) >= at(DAY, "10:00")).toBe(true);
    expect(new Date(moved.t2!.end) <= at(DAY, "12:00")).toBe(true);
    const s2 = applyOp(s, applyReplanOp(s, diff, "re", new Date())).state;
    expect(s2.items.m).toEqual(s.items.m);
  });
});

describe("reminders", () => {
  const meeting = ev("m", DAY, "15:00", "16:00");
  const r: Reminder = {
    id: "r", kind: "reminder", target: { kind: "event", id: "m" }, rule: { type: "before", minutes: 30 },
    channel: "notification", state: "pending", createdAt: at(DAY, "08:00").toISOString(), updatedAt: "x",
  };

  it("fires once at the right time", () => {
    let s = applyOp(stateWith([meeting], { quietStart: "23:00", quietEnd: "06:00" }), { opId: "r", label: "r", source: "manual", put: [r] }).state;
    expect(dueNotifications(s, at(DAY, "14:29"))).toHaveLength(0);
    const due = dueNotifications(s, at(DAY, "14:30"));
    expect(due).toHaveLength(1);
    s = applyOp(s, markShownOp(s, ["r"], at(DAY, "14:30"), "shown")).state;
    expect(dueNotifications(s, at(DAY, "14:40"))).toHaveLength(0);
  });

  it("snoozing does not move the event", () => {
    let s = applyOp(stateWith([meeting]), { opId: "r", label: "r", source: "manual", put: [r] }).state;
    s = applyOp(s, snoozeOp(s.items.r as Reminder, 10, at(DAY, "14:30"), "snooze")).state;
    expect((s.items.m as CalendarEvent).start).toBe(meeting.start);
    expect(dueNotifications(s, at(DAY, "14:35"))).toHaveLength(0);
    expect(dueNotifications(s, at(DAY, "14:40"))).toHaveLength(1);
  });

  it("quiet hours defer, not drop", () => {
    const s = stateWith([], { quietStart: "22:00", quietEnd: "07:00" });
    expect(toHm(afterQuietHours(at(DAY, "23:30"), s.prefs), TZ)).toBe("07:00");
    expect(toHm(afterQuietHours(at(DAY, "12:00"), s.prefs), TZ)).toBe("12:00");
  });
});

describe("time zones", () => {
  it("changing the user's zone does not silently change an absolute event time", () => {
    const s = stateWith([ev("m", DAY, "15:00", "16:00")]);
    const moved = { ...s, prefs: { ...s.prefs, timeZone: "Europe/London" } };
    expect((moved.items.m as CalendarEvent).start).toBe(at(DAY, "15:00").toISOString());
    expect((moved.items.m as CalendarEvent).timeZone).toBe(TZ);
  });
});
