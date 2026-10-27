"use client";

import Link from "next/link";
import type { AgendaEntry } from "@/lib/domain/agenda";
import { completeTaskOp, newId } from "@/lib/domain/store-core";
import { useActions } from "@/lib/client/store";
import { formatDurationHe, minutesBetween, toHm } from "@/lib/time";
import { Icon, cx } from "./ui";

/** One line on a timeline. Events and tasks differ by shape, icon and label — not by color alone. */
export function AgendaRow({ entry, timeZone, now, emphasize }: { entry: AgendaEntry; timeZone: string; now: Date; emphasize?: boolean }) {
  const actions = useActions();
  const start = toHm(new Date(entry.start), timeZone);
  const end = toHm(new Date(entry.end), timeZone);
  const past = new Date(entry.end) < now;
  const current = new Date(entry.start) <= now && now < new Date(entry.end);

  if (entry.type === "event") {
    const o = entry.occ;
    return (
      <li className={cx("flex items-stretch gap-3", past && "opacity-60")}>
        <div className="w-14 shrink-0 pt-3 text-left text-sm text-muted ltr-nums">{start}</div>
        <Link
          href={`/item/${o.eventId}?occ=${o.key}`}
          className={cx(
            "flex flex-1 items-start gap-3 rounded-2xl border-s-[6px] border-accent bg-accent-soft/70 px-4 py-3 hover:bg-accent-soft",
            emphasize && "ring-2 ring-accent",
          )}
        >
          <Icon.Clock size={20} className="mt-0.5 shrink-0 text-accent-strong" />
          <span className="flex-1">
            <span className="sr-only">אירוע: </span>
            <span className="block font-medium">{o.title}</span>
            <span className="block text-sm text-muted">
              <span className="ltr-nums">
                {start}–{end}
              </span>
              {o.location && (
                <>
                  {" · "}
                  {o.location}
                </>
              )}
              {o.recurring && " · חוזר"}
              {current && <strong className="font-semibold text-accent-strong"> · עכשיו</strong>}
            </span>
          </span>
        </Link>
      </li>
    );
  }

  const t = entry.task;
  const done = t.status === "done";
  return (
    <li className={cx("flex items-stretch gap-3", (past || done) && "opacity-60")}>
      <div className="w-14 shrink-0 pt-3 text-left text-sm text-muted ltr-nums">{start}</div>
      <div className={cx("flex flex-1 items-start gap-3 rounded-2xl border border-dashed border-line bg-surface px-4 py-3", emphasize && "ring-2 ring-accent")}>
        <button
          type="button"
          role="checkbox"
          aria-checked={done}
          aria-label={done ? `החזרת ״${t.title}״ לפתוחה` : `סימון ״${t.title}״ כבוצעה`}
          onClick={() => actions.run(completeTaskOp(t, !done, newId("op"), new Date()), done ? "הוחזר לפתוח" : "כל הכבוד — בוצע")}
          className={cx(
            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2",
            done ? "border-accent bg-accent text-on-accent" : "border-muted hover:border-accent",
          )}
        >
          {done && <Icon.Check size={16} />}
        </button>
        <Link href={`/item/${t.id}`} className="flex-1">
          <span className="sr-only">משימה: </span>
          <span className={cx("block font-medium", done && "line-through")}>{t.title}</span>
          <span className="block text-sm text-muted">
            משימה משובצת · {formatDurationHe(minutesBetween(entry.start, entry.end))}
            {t.importance === "high" && " · חשוב"}
          </span>
        </Link>
      </div>
    </li>
  );
}
