import "server-only";
import { Pool } from "pg";
import { authenticate, type DeviceAuth } from "./sync-db";

let pool: Pool | null = null;

/** Sync is available when the deployment has a Postgres database (Railway sets DATABASE_URL). */
export function syncConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function getPool(): Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL!;
    const local = /@(localhost|127\.0\.0\.1|[^/]*\.railway\.internal)[:/]/.test(url);
    pool = new Pool({ connectionString: url, max: 5, ssl: local ? undefined : { rejectUnauthorized: false } });
  }
  return pool;
}

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : null;
}

export async function requireDevice(req: Request): Promise<DeviceAuth | Response> {
  if (!syncConfigured()) return Response.json({ error: "not_configured" }, { status: 503 });
  const auth = await authenticate(getPool(), bearer(req));
  return auth ?? Response.json({ error: "unauthorized" }, { status: 401 });
}

// Simple per-IP limiter for code guessing and account creation. Per instance; enough for one Railway service.
const hits = new Map<string, number[]>();
export function rateLimited(req: Request, bucket: string, max: number, windowMs: number): boolean {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]!.trim() || "local";
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) hits.clear();
  return list.length > max;
}

export const noStore = { "Cache-Control": "no-store" };
