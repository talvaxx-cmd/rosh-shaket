import { z } from "zod";
import { getPool, noStore, rateLimited, syncConfigured } from "@/lib/server/http";
import { redeem } from "@/lib/server/sync-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ code: z.string().min(6).max(40), deviceName: z.string().max(60).default("מכשיר") });

/** A new device joins with a pairing code or the recovery code. */
export async function POST(req: Request) {
  if (!syncConfigured()) return Response.json({ error: "not_configured" }, { status: 503 });
  if (rateLimited(req, "redeem", 10, 10 * 60 * 1000)) return Response.json({ error: "rate_limited" }, { status: 429 });
  const body = Body.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const out = await redeem(getPool(), body.data.code, body.data.deviceName);
  if (!out) return Response.json({ error: "invalid_code" }, { status: 404 });
  return Response.json(out, { headers: noStore });
}
