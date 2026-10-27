/**
 * Reminders delivered by Web Push, so they arrive even when the app is closed.
 *
 * Every tick the server rebuilds each subscribed account's state from the
 * synced items and runs the same `dueNotifications` the app uses (quiet hours,
 * snooze, recurrence). Each notification is sent once (push_sent), and the
 * reminder's "shown" mark is written back as a synced change, so open devices
 * don't show it again.
 */

import type { Pool } from "pg";
import { dueNotifications, markShownOp } from "../domain/reminders";
import { DEFAULT_PREFERENCES, type AppState, type Item, type Preferences } from "../domain/types";
import { ensureSchema } from "./sync-db";

const PUSH_SCHEMA = `
CREATE TABLE IF NOT EXISTS push_config (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  public_key text NOT NULL,
  private_key text NOT NULL,
  subject text NOT NULL
);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES sync_accounts(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES sync_devices(id) ON DELETE CASCADE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS push_sent (
  account_id uuid NOT NULL REFERENCES sync_accounts(id) ON DELETE CASCADE,
  tag text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, tag)
);
`;

const ready = new WeakMap<Pool, Promise<void>>();
export function ensurePushSchema(pool: Pool): Promise<void> {
  let p = ready.get(pool);
  if (!p) {
    p = ensureSchema(pool).then(() => pool.query(PUSH_SCHEMA)).then(() => undefined);
    p.catch(() => ready.delete(pool));
    ready.set(pool, p);
  }
  return p;
}

export interface Vapid {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/**
 * VAPID keys identify this server to the browsers' push services. Taken from env
 * if set; otherwise generated once and kept in the database, so no setup is needed.
 */
export async function getVapid(pool: Pool, generate: () => { publicKey: string; privateKey: string }, subjectHint?: string): Promise<Vapid> {
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    return { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY, subject: process.env.VAPID_SUBJECT || subjectHint || "mailto:push@rosh-shaket.app" };
  }
  await ensurePushSchema(pool);
  const existing = await pool.query<{ public_key: string; private_key: string; subject: string }>("SELECT public_key, private_key, subject FROM push_config WHERE id = 1");
  if (existing.rows[0]) {
    const r = existing.rows[0];
    return { publicKey: r.public_key, privateKey: r.private_key, subject: r.subject };
  }
  const keys = generate();
  await pool.query("INSERT INTO push_config (id, public_key, private_key, subject) VALUES (1, $1, $2, $3) ON CONFLICT (id) DO NOTHING", [
    keys.publicKey,
    keys.privateKey,
    subjectHint || "mailto:push@rosh-shaket.app",
  ]);
  return getVapid(pool, generate, subjectHint);
}

export interface PushSubscriptionJSON {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function saveSubscription(pool: Pool, auth: { accountId: string; deviceId: string }, sub: PushSubscriptionJSON) {
  await ensurePushSchema(pool);
  await pool.query(
    `INSERT INTO push_subscriptions (endpoint, account_id, device_id, p256dh, auth) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE SET account_id = EXCLUDED.account_id, device_id = EXCLUDED.device_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [sub.endpoint, auth.accountId, auth.deviceId, sub.keys.p256dh, sub.keys.auth],
  );
}

export async function removeSubscription(pool: Pool, auth: { accountId: string }, endpoint: string) {
  await ensurePushSchema(pool);
  await pool.query("DELETE FROM push_subscriptions WHERE endpoint = $1 AND account_id = $2", [endpoint, auth.accountId]);
}

export async function subscriptionsFor(pool: Pool, filter: { accountId: string; deviceId?: string }): Promise<PushSubscriptionJSON[]> {
  await ensurePushSchema(pool);
  const r = await pool.query<{ endpoint: string; p256dh: string; auth: string }>(
    `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE account_id = $1 ${filter.deviceId ? "AND device_id = $2" : ""}`,
    filter.deviceId ? [filter.accountId, filter.deviceId] : [filter.accountId],
  );
  return r.rows.map((s) => ({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }));
}

export interface PushPayload {
  title: string;
  body: string;
  tag: string;
  url: string;
  reminderId?: string;
}

/** Returns "gone" when the subscription no longer exists (it is then deleted). */
export type Sender = (sub: PushSubscriptionJSON, payload: PushPayload) => Promise<"ok" | "gone" | "error">;

async function accountState(pool: Pool, accountId: string): Promise<AppState> {
  const items = await pool.query<{ id: string; data: Item }>("SELECT id, data FROM sync_items WHERE account_id = $1 AND NOT deleted", [accountId]);
  const prefs = await pool.query<{ data: Partial<Preferences> }>("SELECT data FROM sync_prefs WHERE account_id = $1", [accountId]);
  return {
    version: 1,
    items: Object.fromEntries(items.rows.map((r) => [r.id, r.data])),
    prefs: { ...DEFAULT_PREFERENCES, ...(prefs.rows[0]?.data ?? {}) },
    history: [],
  };
}

/** Server-side change to synced items (e.g. "reminder shown"), visible to devices on their next sync. */
async function writeItems(pool: Pool, accountId: string, items: Item[], now: Date) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [accountId]);
    for (const it of items) {
      await c.query(
        `UPDATE sync_items SET data = $3, changed_at = $4, seq = nextval('sync_items_seq')
         WHERE account_id = $1 AND id = $2 AND NOT deleted AND changed_at <= $4`,
        [accountId, it.id, JSON.stringify(it), now.toISOString()],
      );
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

/** One scheduler pass. Safe to run from several server instances (single holder of the lock sends). */
export async function pushTick(pool: Pool, send: Sender, now: Date = new Date()): Promise<{ sent: number }> {
  await ensurePushSchema(pool);
  const lockClient = await pool.connect();
  let sent = 0;
  try {
    const lock = await lockClient.query<{ ok: boolean }>("SELECT pg_try_advisory_lock(727001) AS ok");
    if (!lock.rows[0]?.ok) return { sent: 0 };
    try {
      const accounts = await pool.query<{ account_id: string }>("SELECT DISTINCT account_id FROM push_subscriptions");
      for (const { account_id: accountId } of accounts.rows) {
        const state = await accountState(pool, accountId);
        const due = dueNotifications(state, now);
        if (!due.length) continue;

        // Claim each notification once; another tick or instance won't send it again.
        const fresh = [];
        const alreadySent = [];
        for (const d of due) {
          const r = await pool.query("INSERT INTO push_sent (account_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING", [accountId, d.tag]);
          if ((r.rowCount ?? 0) > 0) fresh.push(d);
          else alreadySent.push(d);
        }
        let delivered = false;
        if (fresh.length) {
          const payloads: PushPayload[] =
            fresh.length > 2
              ? [
                  {
                    title: state.prefs.hideNotificationContent ? "ראש שקט" : `${fresh.length} תזכורות`,
                    body: state.prefs.hideNotificationContent ? "יש לך תזכורות" : fresh.map((d) => d.title).join(" · "),
                    tag: `batch:${now.toISOString().slice(0, 16)}`,
                    url: "/",
                  },
                ]
              : fresh.map((d) => ({ title: d.title, body: d.body, tag: d.tag, url: d.url, reminderId: d.reminderId }));
          for (const sub of await subscriptionsFor(pool, { accountId })) {
            for (const p of payloads) {
              const res = await send(sub, p);
              if (res === "gone") {
                await pool.query("DELETE FROM push_subscriptions WHERE endpoint = $1", [sub.endpoint]);
                break;
              }
              if (res === "ok") {
                sent++;
                delivered = true;
              }
            }
          }
          if (!delivered) {
            // Nothing got through (push service down?) — release the claims so the next pass retries.
            await pool.query("DELETE FROM push_sent WHERE account_id = $1 AND tag = ANY($2)", [accountId, fresh.map((d) => d.tag)]);
          }
        }
        // Mark as shown in the synced data only what really went out.
        const shown = [...alreadySent, ...(delivered ? fresh : [])];
        if (shown.length) {
          const op = markShownOp(state, shown.map((d) => d.reminderId), now, "push");
          await writeItems(pool, accountId, op.put ?? [], now);
        }
      }
      await pool.query("DELETE FROM push_sent WHERE sent_at < now() - interval '3 days'");
    } finally {
      await lockClient.query("SELECT pg_advisory_unlock(727001)");
    }
  } finally {
    lockClient.release();
  }
  return { sent };
}
