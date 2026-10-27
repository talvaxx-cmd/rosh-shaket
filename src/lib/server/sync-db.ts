/**
 * Server storage for multi-device sync (Postgres).
 *
 * Model: an account has devices (bearer tokens) and items. Each item row keeps
 * the latest version and a monotonically increasing `seq`, so a device asks for
 * "everything after the last seq I saw". Conflicts: the most recent change wins,
 * per item. Deletions are kept as tombstones so they reach other devices.
 *
 * Secrets (device tokens, pairing and recovery codes) are stored only as SHA-256 hashes.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

export const MAX_CHANGES_PER_REQUEST = 500;
export const MAX_ITEM_BYTES = 20_000;
const PAGE = 1000;
const PAIRING_TTL_MS = 10 * 60 * 1000;

// No 0/O, 1/I/L — easy to read aloud and type on a phone.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Device tokens are random bytes, hashed exactly as issued. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Human-typed codes: case, spaces and dashes don't matter. */
export function hashSecret(s: string): string {
  return createHash("sha256").update(s.trim().toUpperCase().replace(/[\s-]/g, "")).digest("hex");
}

function randomCode(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i]! % ALPHABET.length];
  return out;
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** "ABCD-EFGH" style grouping for display. */
export function groupCode(code: string, size = 4): string {
  return code.match(new RegExp(`.{1,${size}}`, "g"))!.join("-");
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sync_accounts (
  id uuid PRIMARY KEY,
  recovery_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sync_devices (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES sync_accounts(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sync_pairing (
  code_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES sync_accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE SEQUENCE IF NOT EXISTS sync_items_seq;
CREATE TABLE IF NOT EXISTS sync_items (
  account_id uuid NOT NULL REFERENCES sync_accounts(id) ON DELETE CASCADE,
  id text NOT NULL,
  data jsonb,
  deleted boolean NOT NULL DEFAULT false,
  changed_at timestamptz NOT NULL,
  seq bigint NOT NULL DEFAULT nextval('sync_items_seq'),
  PRIMARY KEY (account_id, id)
);
CREATE INDEX IF NOT EXISTS sync_items_seq_idx ON sync_items (account_id, seq);
CREATE TABLE IF NOT EXISTS sync_prefs (
  account_id uuid PRIMARY KEY REFERENCES sync_accounts(id) ON DELETE CASCADE,
  data jsonb NOT NULL,
  changed_at timestamptz NOT NULL
);
`;

const ready = new WeakMap<Pool, Promise<void>>();
export function ensureSchema(pool: Pool): Promise<void> {
  let p = ready.get(pool);
  if (!p) {
    p = pool.query(SCHEMA).then(() => undefined);
    p.catch(() => ready.delete(pool));
    ready.set(pool, p);
  }
  return p;
}

async function tx<T>(pool: Pool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

// ---------- accounts & devices ----------

export interface NewDevice {
  token: string;
  deviceId: string;
}

async function addDevice(c: PoolClient | Pool, accountId: string, name: string): Promise<NewDevice> {
  const token = newToken();
  const deviceId = randomUUID();
  await c.query("INSERT INTO sync_devices (id, account_id, token_hash, name) VALUES ($1, $2, $3, $4)", [
    deviceId,
    accountId,
    hashToken(token),
    name.slice(0, 60) || "מכשיר",
  ]);
  return { token, deviceId };
}

/** Creates an account with this device as its first member. The recovery code is shown once. */
export async function createAccount(pool: Pool, deviceName: string): Promise<NewDevice & { recoveryCode: string }> {
  await ensureSchema(pool);
  const recoveryCode = randomCode(20);
  return tx(pool, async (c) => {
    const accountId = randomUUID();
    await c.query("INSERT INTO sync_accounts (id, recovery_hash) VALUES ($1, $2)", [accountId, hashSecret(recoveryCode)]);
    const d = await addDevice(c, accountId, deviceName);
    return { ...d, recoveryCode: groupCode(recoveryCode) };
  });
}

export interface DeviceAuth {
  accountId: string;
  deviceId: string;
}

export async function authenticate(pool: Pool, token: string | null): Promise<DeviceAuth | null> {
  if (!token || token.length < 20) return null;
  await ensureSchema(pool);
  const r = await pool.query<{ id: string; account_id: string }>(
    "UPDATE sync_devices SET last_seen = now() WHERE token_hash = $1 RETURNING id, account_id",
    [hashToken(token)],
  );
  const row = r.rows[0];
  return row ? { accountId: row.account_id, deviceId: row.id } : null;
}

/** A short single-use code (valid 10 minutes) to link another device. */
export async function startPairing(pool: Pool, auth: DeviceAuth): Promise<{ code: string; expiresAt: string }> {
  const code = randomCode(8);
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
  await pool.query("DELETE FROM sync_pairing WHERE expires_at < now()");
  await pool.query("INSERT INTO sync_pairing (code_hash, account_id, expires_at) VALUES ($1, $2, $3)", [
    hashSecret(code),
    auth.accountId,
    expiresAt,
  ]);
  return { code: groupCode(code), expiresAt: expiresAt.toISOString() };
}

/** Links a new device with a pairing code (single use) or the account's recovery code. */
export async function redeem(pool: Pool, code: string, deviceName: string): Promise<NewDevice | null> {
  await ensureSchema(pool);
  const h = hashSecret(code);
  return tx(pool, async (c) => {
    const p = await c.query<{ account_id: string }>("DELETE FROM sync_pairing WHERE code_hash = $1 AND expires_at > now() RETURNING account_id", [h]);
    let accountId = p.rows[0]?.account_id;
    if (!accountId) {
      const a = await c.query<{ id: string }>("SELECT id FROM sync_accounts WHERE recovery_hash = $1", [h]);
      accountId = a.rows[0]?.id;
    }
    if (!accountId) return null;
    return addDevice(c, accountId, deviceName);
  });
}

export async function listDevices(pool: Pool, auth: DeviceAuth) {
  const r = await pool.query<{ id: string; name: string; created_at: Date; last_seen: Date }>(
    "SELECT id, name, created_at, last_seen FROM sync_devices WHERE account_id = $1 ORDER BY created_at",
    [auth.accountId],
  );
  return r.rows.map((d) => ({ id: d.id, name: d.name, createdAt: d.created_at.toISOString(), lastSeen: d.last_seen.toISOString(), current: d.id === auth.deviceId }));
}

export async function removeDevice(pool: Pool, auth: DeviceAuth, deviceId: string): Promise<boolean> {
  const r = await pool.query("DELETE FROM sync_devices WHERE id = $1 AND account_id = $2", [deviceId, auth.accountId]);
  return (r.rowCount ?? 0) > 0;
}

// ---------- sync ----------

export interface ChangeIn {
  id: string;
  /** null = deleted */
  data: unknown | null;
  /** When the change happened on the device (ISO). The latest change wins. */
  at: string;
}

export interface ChangeOut {
  id: string;
  data: unknown | null;
  at: string;
  seq: number;
}

export interface SyncResult {
  cursor: number;
  changes: ChangeOut[];
  more: boolean;
  prefs: { data: unknown; at: string } | null;
}

export async function sync(
  pool: Pool,
  auth: DeviceAuth,
  input: { cursor: number; changes: ChangeIn[]; prefs?: { data: unknown; at: string } | null },
): Promise<SyncResult> {
  return tx(pool, async (c) => {
    // One sync at a time per account, so seq order matches commit order and no device misses a row.
    await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [auth.accountId]);
    for (const ch of input.changes) {
      await c.query(
        `INSERT INTO sync_items (account_id, id, data, deleted, changed_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (account_id, id) DO UPDATE
           SET data = EXCLUDED.data, deleted = EXCLUDED.deleted, changed_at = EXCLUDED.changed_at, seq = nextval('sync_items_seq')
           WHERE sync_items.changed_at <= EXCLUDED.changed_at`,
        [auth.accountId, ch.id, ch.data === null ? null : JSON.stringify(ch.data), ch.data === null, ch.at],
      );
    }
    if (input.prefs) {
      await c.query(
        `INSERT INTO sync_prefs (account_id, data, changed_at) VALUES ($1, $2, $3)
         ON CONFLICT (account_id) DO UPDATE SET data = EXCLUDED.data, changed_at = EXCLUDED.changed_at
         WHERE sync_prefs.changed_at <= EXCLUDED.changed_at`,
        [auth.accountId, JSON.stringify(input.prefs.data), input.prefs.at],
      );
    }
    const rows = await c.query<{ id: string; data: unknown; deleted: boolean; changed_at: Date; seq: string }>(
      "SELECT id, data, deleted, changed_at, seq FROM sync_items WHERE account_id = $1 AND seq > $2 ORDER BY seq LIMIT $3",
      [auth.accountId, input.cursor, PAGE + 1],
    );
    const more = rows.rows.length > PAGE;
    const page = rows.rows.slice(0, PAGE);
    const changes = page.map((r) => ({ id: r.id, data: r.deleted ? null : r.data, at: r.changed_at.toISOString(), seq: Number(r.seq) }));
    const prefsRow = await c.query<{ data: unknown; changed_at: Date }>("SELECT data, changed_at FROM sync_prefs WHERE account_id = $1", [auth.accountId]);
    const p = prefsRow.rows[0];
    return {
      cursor: changes.length ? changes[changes.length - 1]!.seq : input.cursor,
      changes,
      more,
      prefs: p ? { data: p.data, at: p.changed_at.toISOString() } : null,
    };
  });
}
