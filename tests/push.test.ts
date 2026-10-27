import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { getVapid, pushTick, saveSubscription, type PushPayload, type Sender } from "@/lib/server/push";
import { generateVapid } from "@/lib/server/push-send";
import { authenticate, createAccount, sync } from "@/lib/server/sync-db";
import { at, ev } from "./helpers";

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
const DAY = "2026-10-28";

d("push reminders (Postgres)", () => {
  let pool: Pool;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await pool.query("DROP TABLE IF EXISTS push_sent, push_subscriptions, push_config CASCADE");
  });
  afterAll(async () => {
    await pool.end();
  });

  async function setup(prefs: Record<string, unknown> = {}) {
    const a = await createAccount(pool, "אייפון");
    const auth = (await authenticate(pool, a.token))!;
    const meeting = ev("m1", DAY, "15:00", "16:00", { title: "פגישה עם דני" });
    const reminder = {
      id: "r1", kind: "reminder", target: { kind: "event", id: "m1" }, rule: { type: "before", minutes: 30 },
      channel: "notification", state: "pending", createdAt: at(DAY, "08:00").toISOString(), updatedAt: at(DAY, "08:00").toISOString(),
    };
    await sync(pool, auth, {
      cursor: 0,
      changes: [
        { id: "m1", data: meeting, at: "2026-10-28T06:00:00Z" },
        { id: "r1", data: reminder, at: "2026-10-28T06:00:00Z" },
      ],
      prefs: { data: { timeZone: "Asia/Jerusalem", quietStart: "23:00", quietEnd: "06:00", ...prefs }, at: "2026-10-28T06:00:00Z" },
    });
    await saveSubscription(pool, auth, { endpoint: `https://push.example/${auth.deviceId}`, keys: { p256dh: "BPxxxxxxxxxxxxxxxx", auth: "authxxxx" } });
    return auth;
  }

  function recorder(result: "ok" | "gone" = "ok") {
    const sent: PushPayload[] = [];
    const send: Sender = async (_s, p) => {
      sent.push(p);
      return result;
    };
    return { sent, send };
  }

  it("generates VAPID keys once and reuses them", async () => {
    const a = await getVapid(pool, generateVapid, "https://rosh.example");
    const b = await getVapid(pool, generateVapid);
    expect(a.publicKey).toBe(b.publicKey);
    expect(a.subject).toBe("https://rosh.example");
  });

  it("sends the reminder exactly once at the right time, and marks it shown for all devices", async () => {
    const auth = await setup();
    const { sent, send } = recorder();
    await pushTick(pool, send, at(DAY, "14:29"));
    expect(sent).toHaveLength(0);
    await pushTick(pool, send, at(DAY, "14:30"));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ title: "פגישה עם דני", reminderId: "r1" });
    expect(sent[0]!.body).toContain("15:00");
    await pushTick(pool, send, at(DAY, "14:31"));
    expect(sent).toHaveLength(1); // not again

    const row = await pool.query("SELECT data FROM sync_items WHERE account_id = $1 AND id = 'r1'", [auth.accountId]);
    expect(row.rows[0].data.lastShownAt).toBe(at(DAY, "14:30").toISOString());
  });

  it("hides content on the lock screen when the user asked for it", async () => {
    await pool.query("DELETE FROM push_subscriptions");
    await setup({ hideNotificationContent: true });
    const { sent, send } = recorder();
    await pushTick(pool, send, at(DAY, "14:30"));
    expect(sent[0]).toMatchObject({ title: "ראש שקט", body: "יש לך תזכורת" });
  });

  it("a subscription the push service says is gone is removed", async () => {
    await pool.query("DELETE FROM push_subscriptions");
    await setup();
    const { send } = recorder("gone");
    await pushTick(pool, send, at(DAY, "14:30"));
    const subs = await pool.query("SELECT count(*)::int AS n FROM push_subscriptions");
    expect(subs.rows[0].n).toBe(0);
  });
});

d("push reminders — delivery failures (Postgres)", () => {
  let pool: Pool;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
  });
  afterAll(async () => {
    await pool.end();
  });

  it("when the push service fails, the reminder is not lost: it is retried next pass", async () => {
    await pool.query("DELETE FROM push_subscriptions");
    const a = await createAccount(pool, "אייפון");
    const auth = (await authenticate(pool, a.token))!;
    const meeting = ev("m9", DAY, "15:00", "16:00", { title: "תור לרופא" });
    const reminder = {
      id: "r9", kind: "reminder", target: { kind: "event", id: "m9" }, rule: { type: "before", minutes: 30 },
      channel: "notification", state: "pending", createdAt: at(DAY, "08:00").toISOString(), updatedAt: at(DAY, "08:00").toISOString(),
    };
    await sync(pool, auth, { cursor: 0, changes: [{ id: "m9", data: meeting, at: "2026-10-28T06:00:00Z" }, { id: "r9", data: reminder, at: "2026-10-28T06:00:00Z" }], prefs: { data: { timeZone: "Asia/Jerusalem" }, at: "2026-10-28T06:00:00Z" } });
    await saveSubscription(pool, auth, { endpoint: "https://push.example/flaky", keys: { p256dh: "BPxxxxxxxxxxxxxxxx", auth: "authxxxx" } });

    let fail = true;
    const sent: PushPayload[] = [];
    const send: Sender = async (_s, p) => {
      if (fail) return "error";
      sent.push(p);
      return "ok";
    };
    await pushTick(pool, send, at(DAY, "14:30"));
    let row = await pool.query("SELECT data FROM sync_items WHERE account_id = $1 AND id = 'r9'", [auth.accountId]);
    expect(row.rows[0].data.lastShownAt).toBeUndefined();

    fail = false;
    await pushTick(pool, send, at(DAY, "14:31"));
    expect(sent.map((p) => p.title)).toEqual(["תור לרופא"]);
    row = await pool.query("SELECT data FROM sync_items WHERE account_id = $1 AND id = 'r9'", [auth.accountId]);
    expect(row.rows[0].data.lastShownAt).toBeDefined();
  });
});
