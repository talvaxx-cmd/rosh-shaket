import { z } from "zod";
import { getPool, noStore, requireDevice } from "@/lib/server/http";
import { MAX_CHANGES_PER_REQUEST, MAX_ITEM_BYTES, sync } from "@/lib/server/sync-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Change = z.object({
  id: z.string().regex(/^[A-Za-z0-9_:-]{1,80}$/),
  data: z.record(z.string(), z.unknown()).nullable(),
  at: z.string().datetime(),
});
const Body = z.object({
  cursor: z.number().int().min(0),
  changes: z.array(Change).max(MAX_CHANGES_PER_REQUEST),
  prefs: z.object({ data: z.record(z.string(), z.unknown()), at: z.string().datetime() }).nullable().optional(),
});

/** Push local changes since the last sync, pull everything newer than `cursor`. */
export async function POST(req: Request) {
  const auth = await requireDevice(req);
  if (auth instanceof Response) return auth;
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ error: "bad_request" }, { status: 400 });
  for (const c of body.data.changes) {
    if (c.data && c.data.id !== c.id) return Response.json({ error: "bad_request" }, { status: 400 });
    if (c.data && JSON.stringify(c.data).length > MAX_ITEM_BYTES) return Response.json({ error: "too_large" }, { status: 413 });
  }
  try {
    const out = await sync(getPool(), auth, body.data);
    return Response.json(out, { headers: noStore });
  } catch {
    console.warn("[sync] failed");
    return Response.json({ error: "server_error" }, { status: 500 });
  }
}
