import { z } from "zod";
import { getPool, noStore, requireDevice } from "@/lib/server/http";
import { removeSubscription, saveSubscription } from "@/lib/server/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Sub = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(5).max(100) }),
});

/** This device wants reminders even when the app is closed. */
export async function POST(req: Request) {
  const auth = await requireDevice(req);
  if (auth instanceof Response) return auth;
  const body = Sub.safeParse(await req.json().catch(() => null));
  if (!body.success || !body.data.endpoint.startsWith("https://")) return Response.json({ error: "bad_request" }, { status: 400 });
  await saveSubscription(getPool(), auth, body.data);
  return Response.json({ ok: true }, { headers: noStore });
}

export async function DELETE(req: Request) {
  const auth = await requireDevice(req);
  if (auth instanceof Response) return auth;
  const body = z.object({ endpoint: z.string().max(1000) }).safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "bad_request" }, { status: 400 });
  await removeSubscription(getPool(), auth, body.data.endpoint);
  return Response.json({ ok: true }, { headers: noStore });
}
