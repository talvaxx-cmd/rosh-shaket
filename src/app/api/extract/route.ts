import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { ExtractionUnavailable, extractWithClaude, hasClaudeCredentials } from "@/lib/extraction/claude";
import type { ExtractResponse } from "@/lib/extraction/draft";
import { parseHebrew } from "@/lib/extraction/rules-parser";
import { validateDrafts } from "@/lib/extraction/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RequestSchema = z.object({
  text: z.string().min(1).max(4000),
  /** "ai" (default when configured) or "rules" to force the local parser. */
  mode: z.enum(["auto", "rules"]).default("auto"),
  ctx: z.object({
    now: z.string().datetime(),
    timeZone: z.string().min(1).max(64),
    dayStart: z.string().regex(/^\d{2}:\d{2}$/),
    dayEnd: z.string().regex(/^\d{2}:\d{2}$/),
    defaultEventMin: z.number().int().min(5).max(600),
    defaultTaskMin: z.number().int().min(5).max(600),
  }),
});

function isValidZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Personal content is never written to logs — only the failure category. */
function logFailure(kind: string) {
  console.warn(`[extract] fell back to rules: ${kind}`);
}

export async function POST(req: Request): Promise<Response> {
  let body: z.infer<typeof RequestSchema>;
  try {
    body = RequestSchema.parse(await req.json());
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  if (!isValidZone(body.ctx.timeZone)) return Response.json({ error: "bad_timezone" }, { status: 400 });

  const rules = (): ExtractResponse => {
    const r = parseHebrew(body.text, body.ctx);
    return { ...r, items: validateDrafts(r.items, body.ctx) };
  };

  if (body.mode === "rules" || !hasClaudeCredentials()) {
    return Response.json(rules(), { headers: { "Cache-Control": "no-store" } });
  }

  try {
    const out = await extractWithClaude(body.text, body.ctx);
    const res: ExtractResponse = { mode: "ai", items: validateDrafts(out.items, body.ctx), note: out.note };
    return Response.json(res, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    let kind = "unknown";
    if (err instanceof ExtractionUnavailable) kind = err.message;
    else if (err instanceof Anthropic.RateLimitError) kind = "rate_limited";
    else if (err instanceof Anthropic.AuthenticationError) kind = "auth";
    else if (err instanceof Anthropic.APIConnectionError) kind = "connection";
    else if (err instanceof Anthropic.APIError) kind = `api_${err.status}`;
    logFailure(kind);
    const res = rules();
    return Response.json(
      { ...res, warning: "מנוע השפה לא זמין כרגע, השתמשתי בזיהוי הבסיסי. כדאי לבדוק את הכרטיסים בעיון." },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
