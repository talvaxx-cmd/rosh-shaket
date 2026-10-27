import { getPool, noStore, requireDevice } from "@/lib/server/http";
import { startPairing } from "@/lib/server/sync-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A linked device asks for a short code to link another device. */
export async function POST(req: Request) {
  const auth = await requireDevice(req);
  if (auth instanceof Response) return auth;
  return Response.json(await startPairing(getPool(), auth), { headers: noStore });
}
