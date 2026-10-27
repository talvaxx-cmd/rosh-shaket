"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo } from "react";
import { AgendaList, AgendaRow, TaskRow } from "@/components/AgendaRow";
import { Icon, cx } from "@/components/ui";
import { calendarDay, overlapTitles, type AgendaEntry } from "@/lib/domain/agenda";
import type { AppState } from "@/lib/domain/types";
import { useAppState, useNow } from "@/lib/client/store";
import { HEBREW_WEEKDAYS, addDaysYmd, formatYmdHe, isYmd, parseYmd, toHm, toYmd, weekdayOfYmd, type Ymd } from "@/lib/time";

type View = "day" | "week" | "month";

const VIEWS: { v: View; label: string }[] = [
  { v: "day", label: "יום" },
  { v: "week", label: "שבוע" },
  { v: "month", label: "חודש" },
];
const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const MONTHS_IN = ["בינואר", "בפברואר", "במרץ", "באפריל", "במאי", "ביוני", "ביולי", "באוגוסט", "בספטמבר", "באוקטובר", "בנובמבר", "בדצמבר"];
/** Hebrew day letters — unambiguous, unlike first letters of the names (ר/ש repeat). */
const DAY_LETTERS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

function weekRangeLabel(start: Ymd): string {
  const end = addDaysYmd(start, 6);
  const a = parseYmd(start);
  const b = parseYmd(end);
  if (a.m === b.m) return `${a.d}–${b.d} ${MONTHS_IN[a.m - 1]}`;
  return `${a.d} ${MONTHS_IN[a.m - 1]} – ${b.d} ${MONTHS_IN[b.m - 1]}`;
}

function TodayTag() {
  return <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[0.8rem] font-medium text-accent-strong">היום</span>;
}

function EmptyDay({ ymd, isToday }: { ymd: Ymd; isToday: boolean }) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-4 py-5 text-center">
      <p className="font-medium">אין כלום {isToday ? "להיום" : "ביום הזה"}</p>
      <p className="mt-1 text-[0.95rem] text-muted">אפשר להוסיף בהקלדה או בקול — למשל ״מחר בתשע פגישה עם דני״.</p>
      <Link
        href={`/add?manual=event&date=${ymd}`}
        className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-full bg-accent px-5 font-medium text-on-accent hover:bg-accent-strong"
      >
        <Icon.Plus size={18} /> הוספת אירוע או משימה
      </Link>
    </div>
  );
}

function DayAgenda({ state, ymd, today, now }: { state: AppState; ymd: Ymd; today: Ymd; now: Date }) {
  const tz = state.prefs.timeZone;
  const { timeline, allDay, undated } = calendarDay(state, ymd, tz, today);
  const overlap = overlapTitles(timeline.filter((r): r is AgendaEntry => r.type !== "due"));
  if (timeline.length === 0 && allDay.length === 0 && undated.length === 0) return <EmptyDay ymd={ymd} isToday={ymd === today} />;
  return (
    <div className="grid gap-4">
      {allDay.length > 0 && (
        <section aria-label="לעשות ביום הזה">
          <h3 className="mb-1.5 text-sm font-bold text-muted">{ymd === today ? "לעשות היום" : "לעשות ביום הזה"}</h3>
          <AgendaList>
            {allDay.map((t) => (
              <TaskRow key={t.id} task={t} meta={t.importance === "high" ? "משימה · חשוב" : "משימה"} />
            ))}
          </AgendaList>
        </section>
      )}
      <section aria-label="לפי שעה">
        {(allDay.length > 0 || undated.length > 0) && <h3 className="mb-1.5 text-sm font-bold text-muted">לפי שעה</h3>}
        {timeline.length > 0 ? (
          <AgendaList label="סדר היום">
            {timeline.map((r) =>
              r.type === "due" ? (
                <TaskRow key={`due:${r.id}`} task={r.task} time={toHm(new Date(r.start), tz)} late={new Date(r.start) < now} meta={new Date(r.start) < now ? "משימה · המועד עבר" : `משימה · עד ${toHm(new Date(r.start), tz)}`} />
              ) : (
                <AgendaRow key={`${r.type}:${r.id}:${r.start}`} entry={r} timeZone={tz} now={now} overlapsWith={overlap.get(`${r.id}:${r.start}`)} />
              ),
            )}
          </AgendaList>
        ) : (
          <p className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 text-muted">אין פגישות או משימות בשעה מסוימת.</p>
        )}
      </section>
      {undated.length > 0 && (
        <section aria-label="משימות בלי תאריך">
          <h3 className="mb-1.5 text-sm font-bold text-muted">בלי תאריך · מחכות כאן עד שיבוצעו</h3>
          <AgendaList>
            {undated.map((t) => (
              <TaskRow key={t.id} task={t} meta="משימה · אפשר לקבוע לה יום בלחיצה עליה" />
            ))}
          </AgendaList>
        </section>
      )}
    </div>
  );
}

function WeekRow({ ymd, day, isToday, onOpen, tz }: { ymd: Ymd; day: ReturnType<typeof calendarDay>; isToday: boolean; onOpen: () => void; tz: string }) {
  const count = day.timeline.length + day.allDay.length;
  const empty = count === 0;
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${formatYmdHe(ymd)}${isToday ? " (היום)" : ""}: ${empty ? "אין פריטים" : `${count} פריטים`}`}
        className={cx(
          "flex w-full items-start gap-3 rounded-xl border bg-surface px-3 text-start hover:bg-sunken",
          empty ? "py-2" : "py-2.5",
          isToday ? "border-accent" : "border-line",
        )}
      >
        <span className="w-[5.75rem] shrink-0">
          <span className="block whitespace-nowrap font-semibold leading-tight">יום {HEBREW_WEEKDAYS[weekdayOfYmd(ymd)]}</span>
          <span className="block whitespace-nowrap text-sm text-muted">{formatYmdHe(ymd, { withWeekday: false })}</span>
        </span>
        <span className="min-w-0 flex-1">
          {isToday && (
            <span className="mb-1 inline-block">
              <TodayTag />
            </span>
          )}
          {empty ? (
            <span className="block pt-0.5 text-[0.95rem] text-muted">אין פריטים</span>
          ) : (
            <span className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1">
              {day.allDay.map((t) => (
                <span key={`ad:${t.id}`} className="flex min-w-0 items-center gap-2 text-[0.95rem]">
                  <span className="w-11 shrink-0 text-sm text-muted">היום</span>
                  <span className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-muted" aria-hidden />
                  <span className="sr-only">משימה:</span>
                  <span className="min-w-0 truncate">{t.title}</span>
                </span>
              ))}
              {day.timeline.map((e) => (
                <span key={`${e.type}:${e.id}:${e.start}`} className="flex min-w-0 items-center gap-2 text-[0.95rem]">
                  <span className="w-11 shrink-0 text-muted ltr-nums">{toHm(new Date(e.start), tz)}</span>
                  {e.type === "event" ? (
                    <Icon.Clock size={15} className="shrink-0 text-accent" />
                  ) : (
                    <span className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-muted" aria-hidden />
                  )}
                  <span className="sr-only">{e.type === "event" ? "אירוע:" : "משימה:"}</span>
                  <span className="min-w-0 truncate">{e.type === "event" ? e.occ.title : e.task.title}</span>
                </span>
              ))}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

function CalendarInner() {
  const state = useAppState();
  const now = useNow();
  const router = useRouter();
  const params = useSearchParams();
  const tz = state.prefs.timeZone;
  const today = toYmd(now, tz);
  const view = (["day", "week", "month"].includes(params.get("view") ?? "") ? params.get("view") : "day") as View;
  const raw = params.get("d");
  const day = isYmd(raw) ? raw : today;

  // The day view lives on the home screen; week and month stay here.
  const go = (v: View, d: Ymd) => (v === "day" ? router.push(d === today ? "/" : `/?d=${d}`) : router.replace(`/calendar?view=${v}&d=${d}`, { scroll: false }));
  useEffect(() => {
    if (view === "day") router.replace(day === today ? "/" : `/?d=${day}`);
  }, [view, day, today, router]);

  const weekStart = addDaysYmd(day, -weekdayOfYmd(day));
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysYmd(weekStart, i)), [weekStart]);
  const { y, m } = parseYmd(day);
  const monthFirst = `${y}-${String(m).padStart(2, "0")}-01`;
  const gridStart = addDaysYmd(monthFirst, -weekdayOfYmd(monthFirst));
  const monthCells = useMemo(() => Array.from({ length: 42 }, (_, i) => addDaysYmd(gridStart, i)), [gridStart]);

  const byDay = useMemo(() => {
    const days = view === "month" ? monthCells : view === "week" ? weekDays : [];
    return Object.fromEntries(days.map((d) => [d, calendarDay(state, d, tz, today)]));
  }, [state, tz, view, monthCells, weekDays, today]);

  const step = (dir: 1 | -1) => {
    if (view === "day") go(view, addDaysYmd(day, dir));
    else if (view === "week") go(view, addDaysYmd(day, dir * 7));
    else {
      const t = new Date(Date.UTC(y, m - 1 + dir, 1));
      go(view, `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-01`);
    }
  };

  const containsToday =
    view === "day" ? day === today : view === "week" ? today >= weekStart && today <= addDaysYmd(weekStart, 6) : today.slice(0, 7) === monthFirst.slice(0, 7);

  const periodLabel = view === "day" ? formatYmdHe(day) : view === "week" ? weekRangeLabel(weekStart) : `${MONTHS[m - 1]} ${y}`;
  const stepName = view === "day" ? "יום" : view === "week" ? "שבוע" : "חודש";

  return (
    <>
      <header className="flex items-center justify-between gap-3 pt-1">
        <h1 className="text-2xl font-semibold tracking-tight">יומן</h1>
        <Link
          href={`/add?manual=event&date=${day}`}
          className="inline-flex min-h-10 items-center gap-1 rounded-full border border-line bg-surface px-4 font-medium text-accent-strong hover:bg-sunken"
        >
          <Icon.Plus size={18} /> הוספה
        </Link>
      </header>

      <div role="radiogroup" aria-label="תצוגה" className="mt-3 grid grid-cols-3 rounded-full bg-sunken p-1">
        {VIEWS.map(({ v, label }) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={view === v}
            onClick={() => go(v, day)}
            className={cx("min-h-10 rounded-full font-medium transition-colors", view === v ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink")}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-3 mb-3 flex items-center gap-1">
        <button type="button" aria-label={`ה${stepName} הקודם`} onClick={() => step(-1)} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-sunken">
          <Icon.ChevronRight size={20} />
        </button>
        <h2 className="flex flex-1 items-center justify-center gap-2 text-center text-lg font-semibold" aria-live="polite">
          {periodLabel}
          {view === "day" && day === today && <TodayTag />}
        </h2>
        <button type="button" aria-label={`ה${stepName} הבא`} onClick={() => step(1)} className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-sunken">
          <Icon.ChevronLeft size={20} />
        </button>
        {!containsToday && (
          <button type="button" onClick={() => go(view, today)} className="min-h-10 rounded-full px-3 text-sm font-medium text-accent-strong hover:bg-accent-soft">
            להיום
          </button>
        )}
      </div>

      {view === "day" && <DayAgenda state={state} ymd={day} today={today} now={now} />}

      {view === "week" && (
        <ul className="grid gap-1.5">
          {weekDays.map((d) => (
            <WeekRow key={d} ymd={d} day={byDay[d] ?? { timeline: [], allDay: [], undated: [] }} isToday={d === today} tz={tz} onOpen={() => go("day", d)} />
          ))}
        </ul>
      )}

      {view === "month" && (
        <>
          <div role="grid" aria-label={periodLabel} className="grid grid-cols-7 gap-0.5">
            {DAY_LETTERS.map((w, i) => (
              <div key={w} role="columnheader" aria-label={`יום ${HEBREW_WEEKDAYS[i]}`} className="pb-1 text-center text-sm font-medium text-muted">
                {w}
              </div>
            ))}
            {monthCells.map((d) => {
              const info = byDay[d];
              const ev = info?.timeline.filter((e) => e.type === "event").length ?? 0;
              const tk = (info?.timeline.length ?? 0) - ev + (info?.allDay.length ?? 0);
              const inMonth = d.slice(0, 7) === monthFirst.slice(0, 7);
              const selected = d === day;
              const isToday = d === today;
              return (
                <button
                  key={d}
                  type="button"
                  role="gridcell"
                  aria-selected={selected}
                  aria-current={isToday ? "date" : undefined}
                  onClick={() => go("month", d)}
                  aria-label={`${formatYmdHe(d)}${isToday ? " (היום)" : ""}: ${ev} אירועים, ${tk} משימות`}
                  className={cx(
                    "flex h-14 flex-col items-center justify-start rounded-xl pt-1.5 text-[0.95rem]",
                    selected ? "bg-accent font-semibold text-on-accent" : "hover:bg-sunken",
                    !selected && isToday && "font-semibold text-accent-strong ring-2 ring-inset ring-accent",
                    !inMonth && !selected && "opacity-40",
                  )}
                >
                  <span className="ltr-nums">{parseYmd(d).d}</span>
                  <span className="mt-1 flex h-2 items-center gap-0.5" aria-hidden>
                    {ev > 0 && <span className={cx("h-1.5 w-1.5 rounded-full", selected ? "bg-on-accent" : "bg-accent")} />}
                    {ev > 1 && <span className={cx("h-1.5 w-1.5 rounded-full", selected ? "bg-on-accent" : "bg-accent")} />}
                    {tk > 0 && <span className={cx("h-1.5 w-1.5 rounded-full border", selected ? "border-on-accent" : "border-muted")} />}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 flex items-center justify-center gap-4 text-sm text-muted" aria-hidden>
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-accent" /> אירוע</span>
            <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full border border-muted" /> משימה</span>
          </p>
          <section className="mt-4" aria-label={`סדר היום של ${formatYmdHe(day)}`}>
            <h3 className="mb-2 flex items-center gap-2 font-semibold">
              {formatYmdHe(day)} {day === today && <TodayTag />}
            </h3>
            <DayAgenda state={state} ymd={day} today={today} now={now} />
          </section>
        </>
      )}
    </>
  );
}

export default function CalendarPage() {
  return (
    <Suspense>
      <CalendarInner />
    </Suspense>
  );
}
