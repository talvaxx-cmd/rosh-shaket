"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button, Card, Field, Notice, PageHeader, inputClass } from "@/components/ui";
import { useSync } from "@/lib/client/sync";
import { useActions } from "@/lib/client/store";

/** Linking a device to an existing sync account (pairing code or recovery code). */
function LinkInner() {
  const params = useSearchParams();
  const router = useRouter();
  const sync = useSync();
  const actions = useActions();
  const [code, setCode] = useState(params.get("code") ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (sync.linked) {
    return (
      <>
        <PageHeader title="חיבור מכשיר" />
        <Notice>המכשיר הזה כבר מסונכרן. כדי לחבר אותו לחשבון אחר, קודם מנתקים אותו בהגדרות.</Notice>
        <Button className="mt-4 w-full" onClick={() => router.push("/settings")}>
          להגדרות
        </Button>
      </>
    );
  }

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await sync.join(code);
      actions.setPrefs({ onboarded: true });
      actions.toast({ text: "המכשיר חובר ומסונכרן" });
      router.replace("/");
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      setErr(
        m === "invalid_code"
          ? "הקוד לא נמצא או שפג תוקפו. מבקשים קוד חדש במכשיר המחובר (הגדרות ← סנכרון ← חיבור מכשיר נוסף)."
          : m === "rate_limited"
            ? "יותר מדי ניסיונות. נסו שוב בעוד כמה דקות."
            : m === "not_configured"
              ? "הסנכרון עוד לא הופעל בשרת."
              : "החיבור נכשל — בדקו את הרשת ונסו שוב.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="חיבור מכשיר" subtitle="אותם אירועים ומשימות, בכל המכשירים." />
      <Card className="grid gap-3">
        <p className="text-[0.95rem] text-muted">
          במכשיר שכבר מסונכרן: הגדרות ← סנכרון ← <strong>חיבור מכשיר נוסף</strong>. מזינים כאן את הקוד שמופיע שם — או את קוד השחזור.
        </p>
        <Field label="קוד" htmlFor="code">
          <input
            id="code"
            dir="ltr"
            autoCapitalize="characters"
            autoComplete="one-time-code"
            className={`${inputClass} text-center text-xl font-bold tracking-widest`}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="ABCD-EFGH"
          />
        </Field>
        <p className="text-sm text-muted">אירועים ומשימות שכבר נמצאים במכשיר הזה יתווספו לחשבון — שום דבר לא יימחק.</p>
        {err && <Notice tone="danger">{err}</Notice>}
        <Button variant="primary" size="lg" disabled={busy || code.replace(/[\s-]/g, "").length < 6} onClick={submit}>
          {busy ? "מחבר…" : "חיבור"}
        </Button>
      </Card>
    </>
  );
}

export default function LinkPage() {
  return (
    <Suspense>
      <LinkInner />
    </Suspense>
  );
}
