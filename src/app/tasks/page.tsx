"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Chip, Empty, Icon, LinkButton, PageHeader, cx } from "@/components/ui";
import { taskDueYmd } from "@/lib/domain/agenda";
import { completeTaskOp, newId, tasks as allTasks } from "@/lib/domain/store-core";
import type { Task } from "@/lib/domain/types";
import { useActions, useAppState, useNow } from "@/lib/client/store";
import { addDaysYmd, formatDurationHe, relativeDayHe, toHm, toYmd, weekdayOfYmd } from "@/lib/time";

type StatusFilter = "open" | "done" | "all";
type DueFilter = "any" | "today" | "week" | "none" | "late";

export default function TasksPage() {
  const state = useAppState();
  const actions = useActions();
  const now = useNow();
  const tz = state.prefs.timeZone;
  const today = toYmd(now, tz);
  const weekEnd = addDaysYmd(today, 6 - weekdayOfYmd(today));

  const [status, setStatus] = useState<StatusFilter>("open");
  const [due, setDue] = useState<DueFilter>("any");
  const [importantOnly, setImportantOnly] = useState(false);

  const list = useMemo(() => {
    const dueYmd = (t: Task) => taskDueYmd(t, tz);
    return allTasks(state)
      .filter((t) => t.status !== "dropped")
      .filter((t) => (status === "all" ? true : t.status === status))
      .filter((t) => !importantOnly || t.importance === "high")
      .filter((t) => {
        const d = dueYmd(t);
        switch (due) {
          case "today":
            return d === today;
          case "week":
            return d != null && d >= today && d <= weekEnd;
          case "none":
            return d == null;
          case "late":
            return t.status === "open" && t.due != null && new Date(t.due) < now;
          default:
            return true;
        }
      })
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === "open" ? -1 : 1;
        const ad = a.due ?? "9999";
        const bd = b.due ?? "9999";
        if (ad !== bd) return ad.localeCompare(bd);
        const imp = { high: 0, normal: 1, low: 2 };
        return imp[a.importance] - imp[b.importance] || a.createdAt.localeCompare(b.createdAt);
      });
  }, [state, status, due, importantOnly, today, weekEnd, now, tz]);

  const dueLabel = (t: Task) => {
    if (!t.due) return "בלי מועד";
    const d = new Date(t.due);
    if (t.dueIsDateOnly) return `עד ${relativeDayHe(toYmd(new Date(d.getTime() - 1), tz), today)}`;
    return `עד ${relativeDayHe(toYmd(d, tz), today)} ${toHm(d, tz)}`;
  };

  return (
    <>
      <PageHeader title="משימות" action={<LinkButton href="/add" variant="ghost"><Icon.Plus size={20} /> הוספה</LinkButton>} />

      <div className="mb-2 flex flex-wrap gap-2" role="group" aria-label="סינון לפי מצב">
        <Chip active={status === "open"} onClick={() => setStatus("open")}>פתוחות</Chip>
        <Chip active={status === "done"} onClick={() => setStatus("done")}>בוצעו</Chip>
        <Chip active={status === "all"} onClick={() => setStatus("all")}>הכול</Chip>
      </div>
      <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="סינון לפי מועד וחשיבות">
        {([
          ["any", "כל המועדים"],
          ["today", "להיום"],
          ["week", "השבוע"],
          ["late", "באיחור"],
          ["none", "בלי מועד"],
        ] as [DueFilter, string][]).map(([v, l]) => (
          <Chip key={v} active={due === v} onClick={() => setDue(v)}>{l}</Chip>
        ))}
        <Chip active={importantOnly} onClick={() => setImportantOnly(!importantOnly)}>רק חשובות</Chip>
      </div>

      {list.length === 0 ? (
        <Empty>אין משימות בסינון הזה.</Empty>
      ) : (
        <ul className="grid gap-2">
          {list.map((t) => {
            const done = t.status === "done";
            const late = !done && t.due && new Date(t.due) < now;
            return (
              <li key={t.id} className="flex items-start gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={done}
                  aria-label={done ? `החזרת ״${t.title}״ לפתוחה` : `סימון ״${t.title}״ כבוצעה`}
                  onClick={() => actions.run(completeTaskOp(t, !done, newId("op"), new Date()), done ? "הוחזר לפתוח" : "בוצע")}
                  className={cx("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2", done ? "border-accent bg-accent text-on-accent" : "border-muted hover:border-accent")}
                >
                  {done && <Icon.Check size={16} />}
                </button>
                <Link href={`/item/${t.id}`} className="flex-1">
                  <span className={cx("block font-medium", done && "text-muted line-through")}>{t.title}</span>
                  <span className="flex flex-wrap gap-x-2 text-sm text-muted">
                    <span className={cx(late && "font-medium text-danger")}>{late ? `באיחור · ${dueLabel(t)}` : dueLabel(t)}</span>
                    {t.durationMin && <span>· {formatDurationHe(t.durationMin)}{t.durationAssumed ? " (משוער)" : ""}</span>}
                    {t.importance === "high" && <span className="font-medium text-ink">· חשוב</span>}
                    {t.scheduled && <span>· משובצת <span className="ltr-nums">{toHm(new Date(t.scheduled.start), tz)}</span></span>}
                    {t.prepFor && <span>· הכנה לפגישה</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
