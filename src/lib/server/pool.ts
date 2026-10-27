import { Pool } from "pg";

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
