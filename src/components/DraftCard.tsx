"use client";

import type { Occurrence } from "@/lib/domain/recurrence";
import type { DraftItem, Uncertainty } from "@/lib/extraction/draft";
import { describeRecurrenceHe } from "@/lib/domain/recurrence";
import { formatDurationHe, formatYmdHe, hmToMinutes, minutesToHm, relativeDayHe, toHm } from "@/lib/time";
import { Button, Chip, Field, Icon, KindBadge, cx, inputClass } from "./ui";

const DURATIONS = [15, 30, 45, 60, 90, 120];
const REMINDERS: { m: number; label: string }[] = [
  { m: 0, label: "בזמן" },
  { m: 10, label: "10 דק׳ לפני" },
  { m: 30, label: "חצי שעה לפני" },
  { m: 60, label: "שעה לפני" },
  { m: 1440, label: "יום לפני" },
];

function optionLabel(u: Uncertainty, opt: string, today: string): string {
  if (u.field === "date") return `${relativeDayHe(opt, today)} · ${formatYmdHe(opt, { withWeekday: false })}`;
  return opt;
}

export function DraftCard({
  draft,
  index,
  today,
  timeZone,
  conflicts,
  prepTitle,
  onChange,
  onRemove,
}: {
  draft: DraftItem;
  index: number;
  today: string;
  timeZone: string;
  conflicts: Occurrence[];
  prepTitle?: string;
  onChange: (d: DraftItem) => void;
  onRemove: () => void;
}) {
  const d = draft;
  const id = (f: string) => `d${index}-${f}`;
  const set = (patch: Partial<DraftItem>, resolve?: Uncertainty["field"][]) =>
    onChange({ ...d, ...patch, uncertainties: resolve ? d.uncertainties.filter((u) => !resolve.includes(u.field)) : d.uncertainties });

  const answer = (u: Uncertainty, opt: string) => {
    if (u.field === "time") set({ time: opt }, ["time"]);
    else if (u.field === "date") set({ date: opt }, ["date"]);
    else set({}, [u.field]);
  };

  const blocking = d.uncertainties.filter((u) => u.blocking);
  const notes = d.uncertainties.filter((u) => !u.blocking);

  return (
    <article
      aria-labelledby={id("title")}
      className={cx("rounded-[var(--radius-card)] border bg-surface p-4 sm:p-5", blocking.length ? "border-warn-line" : "border-line")}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <KindBadge kind={d.kind} />
          {d.recurrence && (
            <span className="inline-flex items-center gap-1 text-sm text-muted">
              <Icon.Repeat size={15} />
              {describeRecurrenceHe({ ...d.recurrence, byWeekday: d.recurrence.byWeekday })}
            </span>
          )}
        </div>
        <button type="button" onClick={onRemove} className="flex min-h-10 items-center gap-1 rounded-full px-3 text-sm text-muted hover:bg-sunken" aria-label={`הסרת הכרטיס ${d.title}`}>
          <Icon.X size={16} />
          הסרה
        </button>
      </div>

      {d.sourceText && <p className="mb-3 text-sm text-faint">״{d.sourceText}״</p>}

      <div className="mb-3 flex gap-2" role="group" aria-label="סוג הפריט">
        <Chip active={d.kind === "event"} onClick={() => set({ kind: "event", flexible: false })}>
          אירוע בשעה קבועה
        </Chip>
        <Chip active={d.kind === "task"} onClick={() => set({ kind: "task", flexible: true }, ["time"])}>
          משימה
        </Chip>
      </div>
      <p className="-mt-1 mb-3 text-sm text-muted">
        {d.kind === "event" ? "פגישה, תור או שיחה בשעה קבועה. מופיע ביומן בשעה שלו." : "משהו לעשות. עם תאריך — מופיע ביומן באותו יום; בלי תאריך — מחכה ביומן של היום."}
      </p>

      <div className="grid gap-3">
        <Field label="כותרת" htmlFor={id("title")}>
          <input id={id("title")} className={cx(inputClass, "text-lg font-medium")} value={d.title} onChange={(e) => set({ title: e.target.value }, ["title"])} />
        </Field>

        {d.kind === "unresolved" && d.question && <p className="rounded-xl bg-warn-soft px-3 py-2 text-warn">{d.question}</p>}

        {d.kind !== "unresolved" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={d.kind === "event" ? "תאריך" : "מועד אחרון (לא חובה)"} htmlFor={id("date")}>
              <input id={id("date")} type="date" className={cx(inputClass, "ltr-nums")} value={d.date ?? ""} onChange={(e) => set({ date: e.target.value || null }, e.target.value ? ["date", "due"] : [])} />
            </Field>
            <Field label={d.kind === "event" ? "שעה" : "עד שעה (לא חובה)"} htmlFor={id("time")}>
              <input id={id("time")} type="time" className={cx(inputClass, "ltr-nums")} value={d.time ?? ""} onChange={(e) => set({ time: e.target.value || null }, e.target.value ? ["time"] : [])} />
            </Field>
          </div>
        )}

        {d.date && (
          <p className="-mt-1 text-sm text-muted">
            {relativeDayHe(d.date, today)} · {formatYmdHe(d.date, { withYear: true })}
            {d.time && <span className="ltr-nums"> · {d.time}</span>}
            {d.kind === "event" && d.time && d.durationMin ? (
              <span>
                {" "}
                עד <span className="ltr-nums">{minutesToHm(hmToMinutes(d.time) + d.durationMin)}</span>
              </span>
            ) : null}
          </p>
        )}

        {d.kind !== "unresolved" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={d.kind === "event" ? "משך" : "משך משוער"} htmlFor={id("dur")}>
              <select
                id={id("dur")}
                className={inputClass}
                value={d.durationMin ?? ""}
                onChange={(e) => set({ durationMin: e.target.value ? Number(e.target.value) : null, durationIsEstimate: false }, ["duration"])}
              >
                {d.kind === "task" && <option value="">לא ידוע</option>}
                {[...new Set([...DURATIONS, ...(d.durationMin ? [d.durationMin] : [])])]
                  .sort((a, b) => a - b)
                  .map((m) => (
                    <option key={m} value={m}>
                      {formatDurationHe(m)}
                      {m === d.durationMin && d.durationIsEstimate ? " (משוער)" : ""}
                    </option>
                  ))}
              </select>
            </Field>
            {d.kind === "event" ? (
              <Field label="מקום" htmlFor={id("loc")}>
                <input id={id("loc")} className={inputClass} value={d.location ?? ""} placeholder="לא צוין" onChange={(e) => set({ location: e.target.value || null }, ["location"])} />
              </Field>
            ) : (
              <Field label="חשיבות" htmlFor={id("imp")}>
                <select id={id("imp")} className={inputClass} value={d.importance} onChange={(e) => set({ importance: e.target.value as DraftItem["importance"] })}>
                  <option value="low">נמוכה</option>
                  <option value="normal">רגילה</option>
                  <option value="high">גבוהה</option>
                </select>
              </Field>
            )}
          </div>
        )}

        {d.kind !== "unresolved" && (d.kind === "event" || d.time) && (
          <fieldset>
            <legend className="mb-1 flex items-center gap-1 text-sm font-medium text-muted">
              <Icon.Bell size={16} /> תזכורות
            </legend>
            <div className="flex flex-wrap gap-2">
              {REMINDERS.map((r) => {
                const on = d.reminderMinutesBefore.includes(r.m);
                return (
                  <Chip
                    key={r.m}
                    active={on}
                    onClick={() =>
                      set({ reminderMinutesBefore: on ? d.reminderMinutesBefore.filter((x) => x !== r.m) : [...d.reminderMinutesBefore, r.m].sort((a, b) => a - b) }, ["reminder"])
                    }
                  >
                    {r.label}
                  </Chip>
                );
              })}
            </div>
          </fieldset>
        )}

        {prepTitle && (
          <p className="text-sm text-muted">
            הכנה לקראת: <strong className="font-medium text-ink">{prepTitle}</strong> — תשובץ לפני תחילתו
          </p>
        )}
        {d.people.length > 0 && (
          <p className="text-sm text-muted">
            אנשים: {d.people.join(", ")} <span className="text-faint">(לא מקושרים לאנשי קשר)</span>
          </p>
        )}
      </div>

      {(blocking.length > 0 || conflicts.length > 0 || notes.length > 0) && (
        <div className="mt-4 grid gap-2">
          {blocking.map((u) => (
            <div key={u.field} className="rounded-2xl border border-warn-line bg-warn-soft p-3" role="group" aria-label="נדרשת הבהרה">
              <p className="flex items-center gap-1.5 font-medium text-warn">
                <Icon.Alert size={18} />
                {u.question}
              </p>
              {u.options.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {u.options.map((o, i) => (
                    <Button key={o} size="sm" variant={i === 0 ? "primary" : "secondary"} onClick={() => answer(u, o)}>
                      <span className={u.field === "time" ? "ltr-nums" : undefined}>{optionLabel(u, o, today)}</span>
                    </Button>
                  ))}
                </div>
              )}
              {u.options.length === 0 && <p className="mt-1 text-sm text-warn">אפשר למלא בשדה למעלה.</p>}
            </div>
          ))}
          {conflicts.map((c) => (
            <div key={`${c.eventId}:${c.key}`} className="rounded-2xl border border-danger/25 bg-danger-soft p-3 text-danger" role="alert">
              <p className="flex items-center gap-1.5 font-medium">
                <Icon.Alert size={18} /> התנגשות
              </p>
              <p className="text-sm">
                חופף ל״{c.title}״ (<span className="ltr-nums">{toHm(new Date(c.start), timeZone)}–{toHm(new Date(c.end), timeZone)}</span>). אפשר לשמור בכל זאת או לשנות שעה.
              </p>
            </div>
          ))}
          {notes.map((u) => (
            <div key={u.field} className="flex items-center justify-between gap-2 rounded-2xl bg-sunken px-3 py-2 text-sm text-muted">
              <span>{u.question}</span>
              <button type="button" className="min-h-9 shrink-0 rounded-full px-3 font-medium text-accent-strong hover:bg-accent-soft" onClick={() => set({}, [u.field])}>
                הבנתי
              </button>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}
