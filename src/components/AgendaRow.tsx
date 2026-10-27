"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { AgendaEntry } from "@/lib/domain/agenda";
import { completeTaskOp, newId } from "@/lib/domain/store-core";
import type { Task } from "@/lib/domain/types";
import { useActions } from "@/lib/client/store";
import { formatDurationHe, minutesBetween, toHm } from "@/lib/time";
import { Icon, cx } from "./ui";

/** A plain list with thin dividers — one surface, no box around every item. */
export function AgendaList({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul aria-label={label} className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
      {children}
    </ul>
  );
}

function TaskCheck({ task }: { task: Task }) {
  const actions = useActions();
  const done = task.status === "done";
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={done ? `החזרת ״${task.title}״ לפתוחה` : `סימון ״${task.title}״ כבוצעה`}
      onClick={() => actions.run(completeTaskOp(task, !done, newId("op"), new Date()), done ? "הוחזר לפתוח" : "בוצע")}
      className={cx(
        "-m-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
      )}
    >
      <span className={cx("flex h-6 w-6 items-center justify-center rounded-full border-2", done ? "border-accent bg-accent text-on-accent" : "border-muted")}>
        {done && <Icon.Check size={14} />}
      </span>
    </button>
  );
}

/**
 * One line on a timeline. Events and tasks are different things and look it:
 * events have a time bar; tasks have a checkbox and say "משימה".
 */
export function AgendaRow({
  entry,
  timeZone,
  now,
  tag,
  overlapsWith,
}: {
  entry: AgendaEntry;
  timeZone: string;
  now: Date;
  /** Small label next to the title, e.g. "עכשיו" / "הבא". Highlights the row. */
  tag?: string;
  overlapsWith?: string;
}) {
  const start = toHm(new Date(entry.start), timeZone);
  const end = toHm(new Date(entry.end), timeZone);
  const past = new Date(entry.end) < now;

  if (entry.type === "event") {
    const o = entry.occ;
    return (
      <li className={cx("relative", tag && "bg-accent-soft")}>
        <Link href={`/item/${o.eventId}?occ=${o.key}`} className="flex min-h-14 items-stretch gap-3 px-4 py-3 hover:bg-sunken/60">
          <span className={cx("w-12 shrink-0 pt-0.5 font-medium ltr-nums", past ? "text-faint" : "text-ink")}>{start}</span>
          <span className={cx("w-[3px] shrink-0 rounded-full", past ? "bg-line" : "bg-accent")} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="sr-only">אירוע: </span>
            <span className="flex items-baseline gap-2">
              <span className={cx("min-w-0 font-medium", past && "text-muted")}>{o.title}</span>
              {tag && <span className="shrink-0 rounded-md bg-accent px-1.5 py-px text-[0.75rem] font-medium text-on-accent">{tag}</span>}
            </span>
            <span className="block text-sm text-muted">
              <span className="ltr-nums">
                {start}–{end}
              </span>
              {o.location && ` · ${o.location}`}
              {o.recurring && " · חוזר"}
            </span>
            {overlapsWith && (
              <span className="mt-0.5 flex min-w-0 items-center gap-1 text-sm font-medium text-danger">
                <Icon.Alert size={15} className="shrink-0" />
                <span className="min-w-0 truncate">חופף ל״{overlapsWith}״</span>
              </span>
            )}
          </span>
        </Link>
      </li>
    );
  }

  const t = entry.task;
  const done = t.status === "done";
  return (
    <li className={cx("flex min-h-14 items-start gap-3 px-4 py-3", tag && "bg-accent-soft")}>
      <span className={cx("w-12 shrink-0 pt-0.5 font-medium ltr-nums", past || done ? "text-faint" : "text-ink")}>{start}</span>
      <TaskCheck task={t} />
      <Link href={`/item/${t.id}`} className="min-w-0 flex-1">
        <span className="sr-only">משימה: </span>
        <span className={cx("block font-medium", done && "text-muted line-through")}>{t.title}</span>
        <span className="block text-sm text-muted">
          משימה · {formatDurationHe(minutesBetween(entry.start, entry.end))}
          {t.importance === "high" && " · חשוב"}
        </span>
      </Link>
    </li>
  );
}

/** A task without a time slot (due today, undated, or overdue). With `time`, it sits in the timeline column. */
export function TaskRow({ task, meta, late, time }: { task: Task; meta: ReactNode; late?: boolean; time?: string }) {
  const done = task.status === "done";
  return (
    <li className="flex min-h-14 items-start gap-3 px-4 py-3">
      {time && <span className="w-12 shrink-0 pt-0.5 font-medium text-ink ltr-nums">{time}</span>}
      <TaskCheck task={task} />
      <Link href={`/item/${task.id}`} className="min-w-0 flex-1">
        <span className={cx("block font-medium", done && "text-muted line-through")}>{task.title}</span>
        <span className={cx("block text-sm", late ? "font-medium text-danger" : "text-muted")}>{meta}</span>
      </Link>
    </li>
  );
}
