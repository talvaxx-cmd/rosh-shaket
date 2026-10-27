import { getPool, noStore, syncConfigured } from "@/lib/server/http";
import { getVapid } from "@/lib/server/push";
import { generateVapid } from "@/lib/server/push-send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The public key browsers need to subscribe to this server's push messages. */
export async function GET(req: Request) {
  if (!syncConfigured()) return Response.json({ error: "not_configured" }, { status: 503 });
  const v = await getVapid(getPool(), generateVapid, new URL(req.url).origin.startsWith("https://") ? new URL(req.url).origin : undefined);
  return Response.json({ publicKey: v.publicKey }, { headers: noStore });
}
