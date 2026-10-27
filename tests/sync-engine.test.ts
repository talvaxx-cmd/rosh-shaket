import { describe, expect, it } from "vitest";
import { SyncEngine, type SyncMeta, type SyncStore } from "@/lib/client/sync-engine";

/** A tiny in-memory "server" with the same latest-wins rules as the real one. */
function fakeServer() {
  const rows = new Map<string, { data: unknown | null; at: string; seq: number }>();
  let seq = 0;
  let prefs: { data: Record<string, unknown>; at: string } | null = null;
  let offline = false;
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    if (offline) throw new TypeError("network");
    const body = JSON.parse(String(init.body));
    for (const c of body.changes) {
      const cur = rows.get(c.id);
      if (!cur || cur.at <= c.at) rows.set(c.id, { data: c.data, at: c.at, seq: ++seq });
    }
    if (body.prefs && (!prefs || prefs.at <= body.prefs.at)) prefs = body.prefs;
    const changes = [...rows.entries()].filter(([, r]) => r.seq > body.cursor).sort((a, b) => a[1].seq - b[1].seq).map(([id, r]) => ({ id, ...r }));
    return new Response(JSON.stringify({ cursor: changes.length ? changes[changes.length - 1]!.seq : body.cursor, changes, more: false, prefs }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, rows, setOffline: (v: boolean) => (offline = v) };
}

function device(server: ReturnType<typeof fakeServer>, clock: { t: number }) {
  const items = new Map<string, unknown>();
  let prefs: Record<string, unknown> = { dayStart: "08:00" };
  let meta: SyncMeta | null = null;
  const store: SyncStore = {
    getItem: (id) => items.get(id),
    allItemIds: () => [...items.keys()],
    sharedPrefs: () => prefs,
    applyRemote: (changes, p) => {
      for (const c of changes) c.data === null ? items.delete(c.id) : items.set(c.id, c.data);
      if (p) prefs = p;
    },
  };
  const engine = new SyncEngine(store, {
    fetch: server.fetchImpl,
    load: () => meta,
    save: (m) => (meta = m ? structuredClone(m) : null),
    now: () => new Date(clock.t),
  });
  const local = {
    put(id: string, title: string) {
      items.set(id, { id, title });
      clock.t += 1000;
      engine.markDirty([id], false);
    },
    del(id: string) {
      items.delete(id);
      clock.t += 1000;
      engine.markDirty([id], false);
    },
    setPrefs(p: Record<string, unknown>) {
      prefs = { ...prefs, ...p };
      clock.t += 1000;
      engine.markDirty([], true);
    },
  };
  return { engine, items, local, prefs: () => prefs };
}

describe("sync engine", () => {
  it("two devices end up with the same items, including deletions", async () => {
    const server = fakeServer();
    const clock = { t: Date.parse("2026-10-27T10:00:00Z") };
    const phone = device(server, clock);
    const laptop = device(server, clock);
    phone.local.put("t1", "לקנות חלב"); // before linking: uploaded on link
    await phone.engine.link("tok-a", "dev-a", { uploadLocal: true });
    await laptop.engine.link("tok-b", "dev-b", { uploadLocal: true });
    expect((laptop.items.get("t1") as { title: string }).title).toBe("לקנות חלב");

    laptop.local.put("t2", "לתאם טכנאי");
    await laptop.engine.syncNow();
    phone.local.del("t1");
    await phone.engine.syncNow();
    await laptop.engine.syncNow();
    await phone.engine.syncNow();
    expect([...phone.items.keys()].sort()).toEqual(["t2"]);
    expect([...laptop.items.keys()].sort()).toEqual(["t2"]);
  });

  it("works offline and catches up later without losing either side", async () => {
    const server = fakeServer();
    const clock = { t: Date.parse("2026-10-27T10:00:00Z") };
    const phone = device(server, clock);
    const laptop = device(server, clock);
    await phone.engine.link("a", "a", { uploadLocal: true });
    await laptop.engine.link("b", "b", { uploadLocal: true });

    server.setOffline(true);
    phone.local.put("p1", "מהטלפון");
    await phone.engine.syncNow();
    expect(phone.engine.getSnapshot().status).toBe("offline");
    expect(phone.engine.getSnapshot().pending).toBe(1);

    server.setOffline(false);
    laptop.local.put("l1", "מהמחשב");
    await laptop.engine.syncNow();
    await phone.engine.syncNow();
    await laptop.engine.syncNow();
    expect([...phone.items.keys()].sort()).toEqual(["l1", "p1"]);
    expect([...laptop.items.keys()].sort()).toEqual(["l1", "p1"]);
    expect(phone.engine.getSnapshot().pending).toBe(0);
  });

  it("the later edit wins when both devices edit the same item", async () => {
    const server = fakeServer();
    const clock = { t: Date.parse("2026-10-27T10:00:00Z") };
    const phone = device(server, clock);
    const laptop = device(server, clock);
    await phone.engine.link("a", "a", { uploadLocal: true });
    await laptop.engine.link("b", "b", { uploadLocal: true });
    phone.local.put("x", "גרסה 1");
    await phone.engine.syncNow();
    await laptop.engine.syncNow();

    phone.local.put("x", "מהטלפון");
    laptop.local.put("x", "מהמחשב — מאוחר יותר");
    await phone.engine.syncNow();
    await laptop.engine.syncNow();
    await phone.engine.syncNow();
    expect((phone.items.get("x") as { title: string }).title).toBe("מהמחשב — מאוחר יותר");
    expect((laptop.items.get("x") as { title: string }).title).toBe("מהמחשב — מאוחר יותר");
  });

  it("shared preferences sync", async () => {
    const server = fakeServer();
    const clock = { t: Date.parse("2026-10-27T10:00:00Z") };
    const phone = device(server, clock);
    const laptop = device(server, clock);
    await phone.engine.link("a", "a", { uploadLocal: true });
    await laptop.engine.link("b", "b", { uploadLocal: false });
    phone.local.setPrefs({ dayStart: "06:30" });
    await phone.engine.syncNow();
    await laptop.engine.syncNow();
    expect(laptop.prefs().dayStart).toBe("06:30");
  });

  it("a revoked device stops syncing and keeps its data", async () => {
    const clock = { t: Date.parse("2026-10-27T10:00:00Z") };
    const revoked = (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch;
    const server = { fetchImpl: revoked, rows: new Map(), setOffline: () => false };
    const phone = device(server as unknown as ReturnType<typeof fakeServer>, clock);
    phone.local.put("keep", "נשאר");
    await phone.engine.link("a", "a", { uploadLocal: true });
    expect(phone.engine.getSnapshot().linked).toBe(false);
    expect(phone.engine.getSnapshot().error).toMatch(/נותק/);
    expect(phone.items.has("keep")).toBe(true);
  });
});
