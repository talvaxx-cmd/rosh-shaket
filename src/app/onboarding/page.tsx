"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, Field, Icon, inputClass } from "@/components/ui";
import { useActions, useAppState } from "@/lib/client/store";
import { defaultTimeZone } from "@/lib/time";

const ZONES = ["Asia/Jerusalem", "Europe/London", "Europe/Paris", "America/New_York", "America/Los_Angeles", "Australia/Sydney"];

export default function OnboardingPage() {
  const state = useAppState();
  const actions = useActions();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const p = state.prefs;
  const zones = [...new Set([defaultTimeZone(), p.timeZone, ...ZONES])];

  const finish = (to: string) => {
    actions.setPrefs({ onboarded: true });
    router.replace(to);
  };

  return (
    <div className="mx-auto flex min-h-[85dvh] max-w-md flex-col justify-center gap-6">
      <div className="flex justify-center gap-2" aria-label={`שלב ${step + 1} מתוך 3`}>
        {[0, 1, 2].map((i) => (
          <span key={i} className={`h-1.5 w-10 rounded-full ${i <= step ? "bg-accent" : "bg-line"}`} />
        ))}
      </div>

      {step === 0 && (
        <>
          <div className="text-center">
            <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-3xl bg-accent text-on-accent">
              <Icon.Mic size={38} />
            </div>
            <h1 className="text-3xl font-semibold tracking-tight">ראש שקט</h1>
            <p className="mt-2 text-xl text-muted">אומרים מה צריך. היום מסתדר.</p>
          </div>
          <Card>
            <ul className="grid gap-3">
              <li className="flex gap-3">
                <Icon.Mic className="mt-0.5 shrink-0 text-accent" />
                <span>מדברים בחופשיות — פגישות, משימות ותזכורות, כמה ביחד.</span>
              </li>
              <li className="flex gap-3">
                <Icon.Check className="mt-0.5 shrink-0 text-accent" />
                <span>כל דבר מוצג לאישור לפני שנשמר. מה שלא ברור — נשאל, לא ננחש.</span>
              </li>
              <li className="flex gap-3">
                <Icon.Spark className="mt-0.5 shrink-0 text-accent" />
                <span>כשהיום משתבש — מציעים סדר חדש, ואתם מחליטים.</span>
              </li>
            </ul>
          </Card>
          <Button variant="primary" size="lg" onClick={() => setStep(1)}>
            מתחילים
          </Button>
        </>
      )}

      {step === 1 && (
        <>
          <h1 className="text-2xl font-semibold">שפה ואזור זמן</h1>
          <Card className="grid gap-4">
            <Field label="שפה" htmlFor="lang" hint="שפות נוספות יגיעו בהמשך.">
              <select id="lang" className={inputClass} value="he" disabled>
                <option value="he">עברית</option>
              </select>
            </Field>
            <Field label="אזור זמן" htmlFor="tz" hint="״מחר״ יובן לפי אזור הזמן הזה.">
              <select id="tz" className={inputClass} value={p.timeZone} onChange={(e) => actions.setPrefs({ timeZone: e.target.value })}>
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </Field>
          </Card>
          <div className="flex gap-2">
            <Button variant="primary" size="lg" className="flex-1" onClick={() => setStep(2)}>
              המשך
            </Button>
            <Button size="lg" onClick={() => setStep(0)}>
              חזרה
            </Button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <h1 className="text-2xl font-semibold">מתי אתם פעילים?</h1>
          <Card className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="תחילת היום" htmlFor="ds">
                <input id="ds" type="time" className={`${inputClass} ltr-nums`} value={p.dayStart} onChange={(e) => actions.setPrefs({ dayStart: e.target.value })} />
              </Field>
              <Field label="סוף היום" htmlFor="de">
                <input id="de" type="time" className={`${inputClass} ltr-nums`} value={p.dayEnd} onChange={(e) => actions.setPrefs({ dayEnd: e.target.value })} />
              </Field>
            </div>
            <p className="text-sm text-muted">משימות ישובצו רק בשעות האלה.</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="שעות שקטות מ־" htmlFor="qs">
                <input id="qs" type="time" className={`${inputClass} ltr-nums`} value={p.quietStart} onChange={(e) => actions.setPrefs({ quietStart: e.target.value })} />
              </Field>
              <Field label="עד" htmlFor="qe">
                <input id="qe" type="time" className={`${inputClass} ltr-nums`} value={p.quietEnd} onChange={(e) => actions.setPrefs({ quietEnd: e.target.value })} />
              </Field>
            </div>
            <p className="text-sm text-muted">בשעות השקטות לא יוצגו התראות; הן יחכו לסוף השעות השקטות.</p>
          </Card>
          <Button variant="primary" size="lg" onClick={() => finish("/add?sample=1")}>
            <Icon.Mic />
            לנסות הזנה ראשונה
          </Button>
          <Button variant="ghost" onClick={() => finish("/")}>
            דילוג — אנסה אחר כך
          </Button>
          <p className="text-center text-sm text-faint">
            בקשת הרשאה למיקרופון תופיע רק בהקלטה הראשונה, והרשאת התראות רק כשתיצרו תזכורת. חיבור ליומן — אופציונלי, בהמשך.
          </p>
        </>
      )}
    </div>
  );
}
