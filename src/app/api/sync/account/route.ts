import { z } from "zod";
import { getPool, noStore, rateLimited, syncConfigured } from "@/lib/server/http";
import { createAccount } from "@/lib/server/sync-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ deviceName: z.string().max(60).default("מכשיר") });

/** Turns on sync: creates an account with this device in it. */
export async function POST(req: Request) {
  if (!syncConfigured()) return Response.json({ error: "not_configured" }, { status: 503 });
  if (rateLimited(req, "account", 5, 60 * 60 * 1000)) return Response.json({ error: "rate_limited" }, { status: 429 });
  const body = Body.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const out = await createAccount(getPool(), body.data.deviceName);
  return Response.json(out, { headers: noStore });
}
