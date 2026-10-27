"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AgendaList, AgendaRow, TaskRow } from "@/components/AgendaRow";
import { Button, Icon, LinkButton, Notice, SectionTitle } from "@/components/ui";
import { agendaForDay, calendarDay, overdueTasks, overlapTitles, taskDueYmd, todayTasks, type AgendaEntry } from "@/lib/domain/agenda";
import { useSpeech } from "@/lib/client/speech";
import { useActions, useAppState, useNow } from "@/lib/client/store";
import { addDaysYmd, defaultTimeZone, endOfDay, formatDurationHe, formatYmdHe, relativeDayHe, toHm, toYmd, zonedToInstant } from "@/lib/time";

const ZONE_ACK_KEY = "rosh-shaket:zone-ack";
const UNDATED_LIMIT = 5;

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
    <div className="mb-4">
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
    </div>
  );
}

/** One empty state for a day with nothing in it — leads to an action. */
function EmptyToday() {
  const speech = useSpeech();
  const router = useRouter();
  return (
    <section className="mt-6 rounded-[var(--radius-card)] border border-line bg-surface px-5 py-8 text-center">
      <svg viewBox="0 0 64 40" className="mx-auto mb-3 h-10 w-16 text-accent" aria-hidden fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M6 30h52" />
        <path d="M20 30a12 12 0 0 1 24 0" />
        <path d="M32 8v4M16 14l2.5 2.5M48 14l-2.5 2.5" />
      </svg>
      <h2 className="text-lg font-bold">היום שלך פנוי</h2>
      <p className="mt-1 text-muted">אפשר להוסיף משימה או אירוע, בהקלדה או בקול.</p>
      <div className="mt-5 grid gap-2">
        <LinkButton href="/add" variant="primary">
          <Icon.Plus size={20} /> הוספת משימה או אירוע
        </LinkButton>
        {speech.supported && (
          <Button
            onClick={() => {
              speech.start();
              router.push("/add");
            }}
          >
            <Icon.Mic size={20} /> הוספה בקול
          </Button>
        )}
      </div>
    </section>
  );
}

function TomorrowView({ ymd, today, now }: { ymd: string; today: string; now: Date }) {
  const state = useAppState();
  const tz = state.prefs.timeZone;
  const { timeline, allDay } = useMemo(() => calendarDay(state, ymd, tz, today), [state, ymd, tz, today]);
  const overlap = useMemo(() => overlapTitles(timeline.filter((r): r is AgendaEntry => r.type !== "due")), [timeline]);
  if (!timeline.length && !allDay.length) {
    return (
      <section className="mt-6 rounded-[var(--radius-card)] border border-line bg-surface px-5 py-8 text-center">
        <h2 className="text-lg font-bold">מחר עדיין פנוי</h2>
        <p className="mt-1 text-muted">אפשר להכין אותו מראש — בהקלדה או בקול.</p>
        <LinkButton href={`/add?date=${ymd}`} variant="primary" className="mt-5 w-full">
          <Icon.Plus size={20} /> הוספה למחר
        </LinkButton>
      </section>
    );
  }
  return (
    <>
      {allDay.length > 0 && (
        <>
          <SectionTitle>לעשות מחר</SectionTitle>
          <AgendaList>
            {allDay.map((t) => (
              <TaskRow key={t.id} task={t} meta={t.importance === "high" ? "משימה · חשוב" : "משימה"} />
            ))}
          </AgendaList>
        </>
      )}
      <SectionTitle hint={timeline.length ? `${timeline.length} ${timeline.length === 1 ? "פריט" : "פריטים"}` : undefined}>סדר היום</SectionTitle>
      {timeline.length ? (
        <AgendaList label="סדר היום של מחר">
          {timeline.map((r) =>
            r.type === "due" ? (
              <TaskRow key={`due:${r.id}`} task={r.task} time={toHm(new Date(r.start), tz)} meta={`משימה · עד ${toHm(new Date(r.start), tz)}`} />
            ) : (
              <AgendaRow key={`${r.type}:${r.id}:${r.start}`} entry={r} timeZone={tz} now={now} overlapsWith={overlap.get(`${r.id}:${r.start}`)} />
            ),
          )}
        </AgendaList>
      ) : (
        <p className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 text-muted">אין אירועים מתוכננים למחר.</p>
      )}
    </>
  );
}

export default function TodayPage() {
  const state = useAppState();
  const now = useNow();
  const tz = state.prefs.timeZone;
  const today = toYmd(now, tz);
  const tomorrow = addDaysYmd(today, 1);
  const [showTomorrow, setShowTomorrow] = useState(false);

  const agenda = useMemo(() => agendaForDay(state, today, tz).filter((e) => e.type === "event" || e.task.status !== "dropped"), [state, today, tz]);
  const overlap = useMemo(() => overlapTitles(agenda), [agenda]);
  const todo = useMemo(() => todayTasks(state, today, tz, now), [state, today, tz, now]);
  const late = useMemo(() => overdueTasks(state, now), [state, now]);

  const earlier = agenda.filter((e) => new Date(e.end) <= now);
  const ahead = agenda.filter((e) => new Date(e.end) > now);
  const current = ahead.find((e) => new Date(e.start) <= now);
  const next = ahead.find((e) => new Date(e.start) > now);
  const tagFor = (e: (typeof agenda)[number]) => {
    if (e === current) return "עכשיו";
    if (e !== next || current) return undefined;
    const mins = Math.round((new Date(e.start).getTime() - now.getTime()) / 60000);
    if (mins > 180) return "הבא";
    return `הבא · בעוד ${mins < 60 ? `${Math.max(1, mins)} דק׳` : formatDurationHe(Math.round(mins / 15) * 15)}`;
  };

  const hasEvents = agenda.some((e) => e.type === "event");
  const taskCount = late.length + todo.dueToday.length + todo.undated.length;
  const empty = agenda.length === 0 && taskCount === 0;

  // Planning only makes sense with open tasks and time left in the day.
  const dayEnd = state.prefs.dayEnd > state.prefs.dayStart ? zonedToInstant(today, state.prefs.dayEnd, tz) : endOfDay(today, tz);
  const canPlan = todo.dueToday.length + todo.undated.length > 0 && now < dayEnd;
  const canReplan = ahead.length > 0;

  // A short, concrete summary per problem; details on a second, truncated line.
  const issues: { text: string; detail?: string; href: string }[] = [];
  if (overlap.size > 0) {
    const clashing = agenda.filter((e): e is Extract<typeof e, { type: "event" }> => e.type === "event" && overlap.has(`${e.id}:${e.start}`));
    issues.push({
      text: clashing.length === 2 ? "שני אירועים חופפים היום" : `${clashing.length} אירועים חופפים היום`,
      detail: clashing.map((e) => e.occ.title).join(" · "),
      href: "/attention",
    });
  }
  if (late.length) {
    issues.push({ text: late.length === 1 ? "משימה אחת באיחור" : `${late.length} משימות באיחור`, detail: late.map((t) => t.title).join(" · "), href: "/attention" });
  }
  const unresolved = Object.values(state.items).filter((i) => i.kind === "unresolved").length;
  if (unresolved) issues.push({ text: unresolved === 1 ? "פריט אחד מחכה להבהרה" : `${unresolved} פריטים מחכים להבהרה`, href: "/attention" });

  return (
    <>
      <header className="flex items-start justify-between gap-3 pt-1">
        <div>
          <h1 className="text-[1.75rem] font-bold leading-tight tracking-tight">{showTomorrow ? "מחר" : "היום"}</h1>
          <p className="text-muted">{formatYmdHe(showTomorrow ? tomorrow : today)}</p>
        </div>
        <div className="flex items-center gap-1">
          <Link href={`/calendar?view=day&d=${showTomorrow ? tomorrow : today}`} aria-label="פתיחת היומן" className="flex h-11 w-11 items-center justify-center rounded-xl text-muted hover:bg-sunken">
            <Icon.Calendar size={22} />
          </Link>
          <Link
            href={showTomorrow ? `/add?date=${tomorrow}` : "/add"}
            className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-line bg-surface px-3.5 font-medium text-accent-strong hover:bg-sunken"
          >
            <Icon.Plus size={18} /> הוספה
          </Link>
        </div>
      </header>

      <div role="radiogroup" aria-label="איזה יום" className="mt-3 inline-grid grid-cols-2 rounded-xl bg-sunken p-1">
        {[
          { v: false, label: "היום" },
          { v: true, label: "מחר" },
        ].map((o) => (
          <button
            key={o.label}
            type="button"
            role="radio"
            aria-checked={showTomorrow === o.v}
            onClick={() => setShowTomorrow(o.v)}
            className={`min-h-9 min-w-20 rounded-lg px-4 text-[0.95rem] font-medium ${showTomorrow === o.v ? "bg-surface text-ink shadow-sm" : "text-muted"}`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {showTomorrow ? (
        <TomorrowView ymd={tomorrow} today={today} now={now} />
      ) : (
      <>
      <div className="mt-4">
        <ZoneBanner />
      </div>

      {issues.length > 0 && (
        <ul className="mb-2 grid grid-cols-[minmax(0,1fr)] gap-1.5" aria-label="דורש החלטה">
          {issues.map((i) => (
            <li key={i.text}>
              <Link href={i.href} className="flex items-center gap-2 rounded-xl border border-danger/20 bg-danger-soft px-3 py-2.5 text-[0.95rem] font-medium text-danger">
                <Icon.Alert size={18} className="shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block">{i.text}</span>
                  {i.detail && <span className="block truncate text-sm font-normal">{i.detail}</span>}
                </span>
                <Icon.ChevronLeft size={16} className="shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {empty ? (
        <EmptyToday />
      ) : (
        <>
          <SectionTitle hint={ahead.length ? `${ahead.length} ${ahead.length === 1 ? "פריט" : "פריטים"}` : undefined}>סדר היום</SectionTitle>
          {ahead.length > 0 ? (
            <AgendaList label="סדר היום">
              {ahead.map((e) => (
                <AgendaRow key={`${e.type}:${e.id}:${e.start}`} entry={e} timeZone={tz} now={now} tag={tagFor(e)} overlapsWith={overlap.get(`${e.id}:${e.start}`)} />
              ))}
            </AgendaList>
          ) : (
            <p className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 text-muted">
              {hasEvents ? "אין עוד אירועים היום." : "אין אירועים מתוכננים להיום."}
            </p>
          )}
          {earlier.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer py-1 text-sm text-muted">מוקדם יותר היום ({earlier.length})</summary>
              <div className="mt-2">
                <AgendaList>
                  {earlier.map((e) => (
                    <AgendaRow key={`${e.type}:${e.id}:${e.start}`} entry={e} timeZone={tz} now={now} />
                  ))}
                </AgendaList>
              </div>
            </details>
          )}

          {taskCount > 0 && (
            <>
              <SectionTitle
                hint={
                  <Link href="/tasks" className="underline-offset-4 hover:underline">
                    כל המשימות
                  </Link>
                }
              >
                משימות
              </SectionTitle>
              <AgendaList label="משימות">
                {late.map((t) => {
                  const d = taskDueYmd(t, tz)!;
                  return <TaskRow key={t.id} task={t} late meta={`באיחור · המועד היה ${relativeDayHe(d, today)}`} />;
                })}
                {todo.dueToday.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    meta={t.dueIsDateOnly ? "להיום" : <>עד <span className="ltr-nums">{toHm(new Date(t.due!), tz)}</span></>}
                  />
                ))}
                {todo.undated.slice(0, UNDATED_LIMIT).map((t) => (
                  <TaskRow key={t.id} task={t} meta={t.importance === "high" ? "בלי מועד · חשוב" : "בלי מועד"} />
                ))}
              </AgendaList>
              {todo.undated.length > UNDATED_LIMIT && (
                <Link href="/tasks" className="mt-2 block text-sm text-muted underline-offset-4 hover:underline">
                  ועוד {todo.undated.length - UNDATED_LIMIT} משימות בלי מועד
                </Link>
              )}
            </>
          )}

          {(canPlan || canReplan) && (
            <div className="mt-6 grid gap-2">
              {canPlan && (
                <LinkButton href="/plan" variant="primary">
                  <Icon.Plan size={20} /> תכנן לי את היום
                </LinkButton>
              )}
              {canReplan && (
                <Link href="/plan?mode=disrupt" className="inline-flex min-h-11 items-center justify-center gap-1.5 text-[0.95rem] font-medium text-accent-strong">
                  <Icon.Replan size={18} /> משהו השתנה? תכנון מחדש
                </Link>
              )}
            </div>
          )}
        </>
      )}

      </>
      )}

      <p className="mt-8 text-center text-sm">
        <Link href="/history" className="text-muted underline-offset-4 hover:underline">
          היסטוריה ופריטים שהושלמו
        </Link>
      </p>
    </>
  );
}
