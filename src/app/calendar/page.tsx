"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo } from "react";
import { AgendaRow } from "@/components/AgendaRow";
import { Button, Chip, Empty, Icon, PageHeader, cx } from "@/components/ui";
import { agendaForDay } from "@/lib/domain/agenda";
import { useAppState, useNow } from "@/lib/client/store";
import { HEBREW_WEEKDAYS, addDaysYmd, formatYmdHe, isYmd, parseYmd, relativeDayHe, toHm, toYmd, weekdayOfYmd } from "@/lib/time";

type View = "day" | "week" | "month";

const MONTH_NAMES = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

function CalendarInner() {
  const state = useAppState();
  const now = useNow();
  const router = useRouter();
  const params = useSearchParams();
  const tz = state.prefs.timeZone;
  const today = toYmd(now, tz);
  const view = (params.get("view") as View) || "day";
  const raw = params.get("d");
  const day = isYmd(raw) ? raw : today;

  const go = (v: View, d: string) => router.replace(`/calendar?view=${v}&d=${d}`, { scroll: false });

  const step = (dir: 1 | -1) => {
    if (view === "day") go(view, addDaysYmd(day, dir));
    else if (view === "week") go(view, addDaysYmd(day, dir * 7));
    else {
      const { y, m } = parseYmd(day);
      const t = new Date(Date.UTC(y, m - 1 + dir, 1));
      go(view, `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-01`);
    }
  };

  const weekStart = addDaysYmd(day, -weekdayOfYmd(day));
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysYmd(weekStart, i)), [weekStart]);

  const { y, m } = parseYmd(day);
  const monthFirst = `${y}-${String(m).padStart(2, "0")}-01`;
  const gridStart = addDaysYmd(monthFirst, -weekdayOfYmd(monthFirst));
  const monthCells = useMemo(() => Array.from({ length: 42 }, (_, i) => addDaysYmd(gridStart, i)), [gridStart]);

  const counts = useMemo(() => {
    const days = view === "month" ? monthCells : view === "week" ? weekDays : [day];
    return Object.fromEntries(days.map((d) => [d, agendaForDay(state, d, tz)]));
  }, [state, tz, view, monthCells, weekDays, day]);

  const title =
    view === "day" ? relativeDayHe(day, today) : view === "week" ? `שבוע ${formatYmdHe(weekStart, { withWeekday: false })}` : `${MONTH_NAMES[m - 1]} ${y}`;

  return (
    <>
      <PageHeader title="יומן" />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2" role="group" aria-label="תצוגה">
          <Chip active={view === "day"} onClick={() => go("day", day)}>יום</Chip>
          <Chip active={view === "week"} onClick={() => go("week", day)}>שבוע</Chip>
          <Chip active={view === "month"} onClick={() => go("month", day)}>חודש</Chip>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" aria-label="הקודם" onClick={() => step(-1)}>
            <Icon.ChevronRight size={20} />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => go(view, today)}>
            היום
          </Button>
          <Button size="sm" variant="ghost" aria-label="הבא" onClick={() => step(1)}>
            <Icon.ChevronLeft size={20} />
          </Button>
        </div>
      </div>
      <h2 className="mb-3 text-xl font-semibold" aria-live="polite">
        {title}
        {view === "day" && day !== today && <span className="ms-2 text-base font-normal text-muted">{formatYmdHe(day, { withWeekday: false })}</span>}
      </h2>

      {view === "day" &&
        ((counts[day] ?? []).length ? (
          <ul className="grid gap-2">
            {(counts[day] ?? []).map((e) => (
              <AgendaRow key={`${e.type}:${e.id}:${e.start}`} entry={e} timeZone={tz} now={now} />
            ))}
          </ul>
        ) : (
          <Empty>אין אירועים או משימות משובצות ביום הזה.</Empty>
        ))}

      {view === "week" && (
        <div className="grid gap-3">
          {weekDays.map((d) => {
            const entries = counts[d] ?? [];
            return (
              <section key={d} aria-label={formatYmdHe(d)} className={cx("rounded-2xl border bg-surface p-3", d === today ? "border-accent" : "border-line")}>
                <button type="button" onClick={() => go("day", d)} className="mb-1 flex w-full items-baseline justify-between text-start">
                  <span className="font-semibold">{relativeDayHe(d, today) === formatYmdHe(d) ? `יום ${HEBREW_WEEKDAYS[weekdayOfYmd(d)]}` : relativeDayHe(d, today)}</span>
                  <span className="text-sm text-muted">{formatYmdHe(d, { withWeekday: false })}</span>
                </button>
                {entries.length === 0 ? (
                  <p className="text-sm text-faint">פנוי</p>
                ) : (
                  <ul className="grid gap-1">
                    {entries.map((e) => (
                      <li key={`${e.type}:${e.id}:${e.start}`} className="flex gap-2 text-[0.95rem]">
                        <span className="w-12 shrink-0 text-muted ltr-nums">{toHm(new Date(e.start), tz)}</span>
                        <span className="flex items-center gap-1.5">
                          {e.type === "event" ? <Icon.Clock size={15} className="text-accent" /> : <span className="h-3.5 w-3.5 rounded-full border-2 border-muted" aria-hidden />}
                          <span className="sr-only">{e.type === "event" ? "אירוע:" : "משימה:"}</span>
                          {e.type === "event" ? e.occ.title : e.task.title}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      {view === "month" && (
        <div role="grid" aria-label={title} className="grid grid-cols-7 gap-1">
          {HEBREW_WEEKDAYS.map((w) => (
            <div key={w} role="columnheader" className="pb-1 text-center text-sm text-muted">
              {w === "שבת" ? "ש׳" : w[0] + "׳"}
            </div>
          ))}
          {monthCells.map((d) => {
            const entries = counts[d] ?? [];
            const inMonth = d.slice(0, 7) === monthFirst.slice(0, 7);
            const ev = entries.filter((e) => e.type === "event").length;
            const tk = entries.length - ev;
            return (
              <button
                key={d}
                type="button"
                role="gridcell"
                onClick={() => go("day", d)}
                aria-label={`${formatYmdHe(d)}: ${ev} אירועים, ${tk} משימות`}
                className={cx(
                  "flex aspect-square flex-col items-center justify-start rounded-xl border p-1 text-sm",
                  d === today ? "border-accent bg-accent-soft font-semibold" : "border-transparent hover:bg-sunken",
                  !inMonth && "opacity-40",
                )}
              >
                <span className="ltr-nums">{parseYmd(d).d}</span>
                <span className="mt-auto flex gap-0.5" aria-hidden>
                  {Array.from({ length: Math.min(ev, 3) }, (_, i) => (
                    <span key={`e${i}`} className="h-1.5 w-1.5 rounded-full bg-accent" />
                  ))}
                  {Array.from({ length: Math.min(tk, 2) }, (_, i) => (
                    <span key={`t${i}`} className="h-1.5 w-1.5 rounded-full border border-muted" />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
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
