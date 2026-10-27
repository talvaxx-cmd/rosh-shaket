import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { authenticate, createAccount, ensureSchema, listDevices, redeem, removeDevice, startPairing, sync } from "@/lib/server/sync-db";

// Runs against a real Postgres when TEST_DATABASE_URL is set (skipped otherwise).
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d("sync storage (Postgres)", () => {
  let pool: Pool;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    await pool.query("DROP TABLE IF EXISTS sync_prefs, sync_items, sync_pairing, sync_devices, sync_accounts CASCADE; DROP SEQUENCE IF EXISTS sync_items_seq");
    await ensureSchema(pool);
  });
  afterAll(async () => {
    await pool.end();
  });

  const item = (id: string, title: string) => ({ id, kind: "task", title, status: "open" });

  it("creates an account and authenticates its device; bad tokens fail", async () => {
    const a = await createAccount(pool, "אייפון");
    expect(a.recoveryCode).toMatch(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){4}$/);
    const auth = await authenticate(pool, a.token);
    expect(auth?.deviceId).toBe(a.deviceId);
    expect(await authenticate(pool, a.token.toUpperCase())).toBeNull();
    expect(await authenticate(pool, "x".repeat(43))).toBeNull();
  });

  it("pairing code links a second device once; recovery code always works", async () => {
    const a = await createAccount(pool, "אייפון");
    const authA = (await authenticate(pool, a.token))!;
    const { code } = await startPairing(pool, authA);
    const b = await redeem(pool, code.toLowerCase(), "מחשב");
    expect(b).not.toBeNull();
    expect((await authenticate(pool, b!.token))!.accountId).toBe(authA.accountId);
    expect(await redeem(pool, code, "עוד מכשיר")).toBeNull(); // single use
    const c = await redeem(pool, a.recoveryCode.replace(/-/g, " "), "טאבלט");
    expect((await authenticate(pool, c!.token))!.accountId).toBe(authA.accountId);
    expect(await listDevices(pool, authA)).toHaveLength(3);
    expect(await redeem(pool, "WRONGCODE", "x")).toBeNull();
  });

  it("changes flow between devices; the latest change wins; deletions propagate", async () => {
    const a = await createAccount(pool, "A");
    const authA = (await authenticate(pool, a.token))!;
    const { code } = await startPairing(pool, authA);
    const b = await redeem(pool, code, "B");
    const authB = (await authenticate(pool, b!.token))!;

    // A creates an item.
    const r1 = await sync(pool, authA, { cursor: 0, changes: [{ id: "t1", data: item("t1", "לקנות חלב"), at: "2026-10-27T10:00:00Z" }] });
    expect(r1.changes.map((c) => c.id)).toEqual(["t1"]);

    // B pulls it.
    const r2 = await sync(pool, authB, { cursor: 0, changes: [] });
    expect(r2.changes[0]!.data).toMatchObject({ title: "לקנות חלב" });

    // B edits later; A's older offline edit loses.
    await sync(pool, authB, { cursor: r2.cursor, changes: [{ id: "t1", data: item("t1", "לקנות חלב ולחם"), at: "2026-10-27T11:00:00Z" }] });
    const r3 = await sync(pool, authA, { cursor: r1.cursor, changes: [{ id: "t1", data: item("t1", "ישן"), at: "2026-10-27T10:30:00Z" }] });
    expect(r3.changes.find((c) => c.id === "t1")!.data).toMatchObject({ title: "לקנות חלב ולחם" });

    // A deletes; B receives a tombstone.
    await sync(pool, authA, { cursor: r3.cursor, changes: [{ id: "t1", data: null, at: "2026-10-27T12:00:00Z" }] });
    const r4 = await sync(pool, authB, { cursor: r2.cursor, changes: [] });
    expect(r4.changes.find((c) => c.id === "t1")!.data).toBeNull();

    // Nothing new → empty page, cursor unchanged.
    const r5 = await sync(pool, authB, { cursor: r4.cursor, changes: [] });
    expect(r5.changes).toHaveLength(0);
    expect(r5.cursor).toBe(r4.cursor);
  });

  it("accounts never see each other's data", async () => {
    const a = await createAccount(pool, "A");
    const x = await createAccount(pool, "X");
    const authA = (await authenticate(pool, a.token))!;
    const authX = (await authenticate(pool, x.token))!;
    await sync(pool, authA, { cursor: 0, changes: [{ id: "secret", data: item("secret", "פרטי"), at: "2026-10-27T10:00:00Z" }] });
    const rx = await sync(pool, authX, { cursor: 0, changes: [] });
    expect(rx.changes.find((c) => c.id === "secret")).toBeUndefined();
  });

  it("preferences sync with latest-wins", async () => {
    const a = await createAccount(pool, "A");
    const auth = (await authenticate(pool, a.token))!;
    await sync(pool, auth, { cursor: 0, changes: [], prefs: { data: { dayStart: "07:00" }, at: "2026-10-27T10:00:00Z" } });
    const r = await sync(pool, auth, { cursor: 0, changes: [], prefs: { data: { dayStart: "09:00" }, at: "2026-10-27T09:00:00Z" } });
    expect(r.prefs!.data).toEqual({ dayStart: "07:00" });
  });

  it("a removed device can no longer sync", async () => {
    const a = await createAccount(pool, "A");
    const auth = (await authenticate(pool, a.token))!;
    expect(await removeDevice(pool, auth, auth.deviceId)).toBe(true);
    expect(await authenticate(pool, a.token)).toBeNull();
  });
});
