"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { AgendaRow } from "@/components/AgendaRow";
import { Button, Card, Empty, Icon, LinkButton, Notice, SectionTitle } from "@/components/ui";
import { agendaForDay } from "@/lib/domain/agenda";
import { attention } from "@/lib/domain/attention";
import { useActions, useAppState, useNow } from "@/lib/client/store";
import { defaultTimeZone, formatYmdHe, toHm, toYmd, zonedParts } from "@/lib/time";

function greeting(hour: number) {
  if (hour < 5) return "לילה טוב";
  if (hour < 12) return "בוקר טוב";
  if (hour < 17) return "צהריים טובים";
  if (hour < 21) return "ערב טוב";
  return "לילה טוב";
}

const ZONE_ACK_KEY = "rosh-shaket:zone-ack";

function ZoneBanner() {
  const state = useAppState();
  const actions = useActions();
  const device = defaultTimeZone();
  const [ackFor, setAckFor] = useState<string | null>(() => {
    try {
      return localStorage.getItem(ZONE_ACK_KEY);
    } catch {
      return null;
    }
  });
  if (device === state.prefs.timeZone || ackFor === device) return null;
  const acknowledge = () => {
    try {
      localStorage.setItem(ZONE_ACK_KEY, device);
    } catch {}
    setAckFor(device);
  };
  return (
    <Notice tone="warn" title="נראה שאזור הזמן השתנה">
      <p>
        המכשיר מוגדר ל־{device}, והאפליקציה ל־{state.prefs.timeZone}. אירועים שכבר נשמרו נשארים במועד המוחלט שלהם — שום דבר לא זז בשקט.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="primary" onClick={() => actions.setPrefs({ timeZone: device })}>
          להציג לפי {device}
        </Button>
        <Button size="sm" onClick={acknowledge}>
          להשאיר כך
        </Button>
      </div>
    </Notice>
  );
}

export default function TodayPage() {
  const state = useAppState();
  const now = useNow();
  const tz = state.prefs.timeZone;
  const today = toYmd(now, tz);

  const agenda = useMemo(() => agendaForDay(state, today, tz).filter((e) => e.type === "event" || e.task.status !== "dropped"), [state, today, tz]);
  const att = useMemo(() => attention(state, now), [state, now]);

  const current = agenda.filter((e) => new Date(e.start) <= now && now < new Date(e.end));
  const upcoming = agenda.filter((e) => new Date(e.start) > now);
  const earlier = agenda.filter((e) => new Date(e.end) <= now);
  const next = upcoming[0];

  return (
    <>
      <header className="mb-4 pt-2">
        <p className="text-muted">{greeting(zonedParts(now, tz).hour)}</p>
        <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight">{formatYmdHe(today)}</h1>
      </header>

      <ZoneBanner />

      <SectionTitle>מה עכשיו</SectionTitle>
      {current.length > 0 ? (
        <ul className="grid gap-2">
          {current.map((e) => (
            <AgendaRow key={`${e.type}:${e.id}:${e.start}`} entry={e} timeZone={tz} now={now} emphasize />
          ))}
        </ul>
      ) : (
        <Card className="bg-accent-soft/40">
          <p className="text-lg">
            {next ? (
              <>
                זמן פנוי עד <span className="ltr-nums font-semibold">{toHm(new Date(next.start), tz)}</span>
              </>
            ) : (
              "אין עוד התחייבויות היום."
            )}
          </p>
          {att.dueTodayUnscheduled.length > 0 && (
            <p className="mt-1 text-muted">
              {att.dueTodayUnscheduled.length === 1 ? "משימה אחת" : `${att.dueTodayUnscheduled.length} משימות`} להיום עדיין בלי זמן.
            </p>
          )}
        </Card>
      )}

      <SectionTitle hint={upcoming.length ? `${upcoming.length} פריטים` : undefined}>מה בהמשך</SectionTitle>
      {upcoming.length ? (
        <ul className="grid gap-2">
          {upcoming.map((e) => (
            <AgendaRow key={`${e.type}:${e.id}:${e.start}`} entry={e} timeZone={tz} now={now} />
          ))}
        </ul>
      ) : (
        <Empty>
          היום פנוי מכאן והלאה.{" "}
          <Link href="/add" className="font-medium text-accent-strong underline underline-offset-4">
            מה צריך?
          </Link>
        </Empty>
      )}

      {att.dueTodayUnscheduled.length > 0 && (
        <ul className="mt-3 grid gap-1.5">
          {att.dueTodayUnscheduled.map((t) => (
            <li key={t.id}>
              <Link href={`/item/${t.id}`} className="flex items-center gap-2 rounded-xl px-3 py-2 hover:bg-sunken">
                <span className="h-5 w-5 rounded-full border-2 border-muted" aria-hidden />
                <span className="flex-1">{t.title}</span>
                <span className="text-sm text-muted">להיום · בלי זמן</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <LinkButton href="/plan" variant="primary">
          <Icon.Spark size={20} />
          הצעת תכנון
        </LinkButton>
        <LinkButton href="/plan?mode=disrupt">
          <Icon.Alert size={20} />
          היום השתבש
        </LinkButton>
      </div>

      <SectionTitle>מה דורש טיפול</SectionTitle>
      {att.total === 0 ? (
        <Empty>הכול מסודר. אין התנגשויות, איחורים או שאלות פתוחות.</Empty>
      ) : (
        <Link href="/attention" className="block rounded-[var(--radius-card)] border border-warn-line bg-warn-soft p-4 text-warn hover:brightness-[0.98]">
          <span className="flex items-center gap-2 text-lg font-semibold">
            <Icon.Alert />
            {att.total === 1 ? "דבר אחד" : `${att.total} דברים`} מחכים להחלטה
          </span>
          <span className="mt-1 block">
            {[
              att.conflicts.length && `${att.conflicts.length} התנגשויות`,
              att.overdue.length && `${att.overdue.length} באיחור`,
              att.unresolved.length && `${att.unresolved.length} לבירור`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </Link>
      )}

      {earlier.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-muted">מוקדם יותר היום ({earlier.length})</summary>
          <ul className="mt-2 grid gap-2">
            {earlier.map((e) => (
              <AgendaRow key={`${e.type}:${e.id}:${e.start}`} entry={e} timeZone={tz} now={now} />
            ))}
          </ul>
        </details>
      )}
      <p className="mt-6 text-center text-sm">
        <Link href="/history" className="text-muted underline-offset-4 hover:underline">
          היסטוריית שינויים ופריטים שהושלמו
        </Link>
      </p>
    </>
  );
}
