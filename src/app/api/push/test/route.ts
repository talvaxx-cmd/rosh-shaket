import { getPool, noStore, requireDevice } from "@/lib/server/http";
import { getVapid, subscriptionsFor } from "@/lib/server/push";
import { generateVapid, makeSender } from "@/lib/server/push-send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sends a test notification to this device through the push service. */
export async function POST(req: Request) {
  const auth = await requireDevice(req);
  if (auth instanceof Response) return auth;
  const pool = getPool();
  const subs = await subscriptionsFor(pool, auth);
  if (!subs.length) return Response.json({ error: "no_subscription" }, { status: 404 });
  const send = makeSender(await getVapid(pool, generateVapid));
  const results = await Promise.all(
    subs.map((s) => send(s, { title: "בדיקת התראה", body: "התראות מגיעות גם כשהאפליקציה סגורה ✓", tag: `test:${Date.now()}`, url: "/settings" })),
  );
  return Response.json({ sent: results.filter((r) => r === "ok").length }, { headers: noStore });
}
