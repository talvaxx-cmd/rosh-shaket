import { z } from "zod";
import { getPool, noStore, requireDevice } from "@/lib/server/http";
import { listDevices, removeDevice } from "@/lib/server/sync-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireDevice(req);
  if (auth instanceof Response) return auth;
  return Response.json({ devices: await listDevices(getPool(), auth) }, { headers: noStore });
}

const Body = z.object({ deviceId: z.string().uuid() });

/** Unlinks a device (this one or another of the account's devices). */
export async function DELETE(req: Request) {
  const auth = await requireDevice(req);
  if (auth instanceof Response) return auth;
  const body = Body.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const ok = await removeDevice(getPool(), auth, body.data.deviceId);
  return Response.json({ ok }, { status: ok ? 200 : 404, headers: noStore });
}
