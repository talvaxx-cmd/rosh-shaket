"use client";

import { addDaysYmd, formatYmdHe, relativeDayHe, type Ymd } from "@/lib/time";
import { Chip, Icon, cx } from "./ui";

/**
 * Day and time, readable at a glance. The phone's own pickers (iOS wheels) open on tap,
 * but what is shown is our own text — native date/time boxes overflow and show a
 * placeholder time on iPhone even when no time was set.
 */
export function WhenFields({
  idPrefix,
  date,
  time,
  onDate,
  onTime,
  today,
  allowNoDate,
  allowNoTime,
  hint,
}: {
  idPrefix: string;
  date: string;
  time: string;
  onDate: (v: string) => void;
  onTime: (v: string) => void;
  today: Ymd;
  allowNoDate?: boolean;
  allowNoTime?: boolean;
  hint?: string;
}) {
  const tomorrow = addDaysYmd(today, 1);
  const dayText = date ? (date === today || date === tomorrow ? `${relativeDayHe(date, today)} · ${formatYmdHe(date)}` : formatYmdHe(date, { withYear: date.slice(0, 4) !== today.slice(0, 4) })) : "בלי תאריך";
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium text-muted">מתי</legend>
      <PickerBox id={`${idPrefix}-date`} type="date" value={date} onChange={onDate} label="בחירת יום" icon={<Icon.Calendar size={20} />}>
        <span className={cx("truncate", !date && "text-muted")}>{dayText}</span>
      </PickerBox>
      <div className="flex flex-wrap gap-2">
        <Chip active={date === today} onClick={() => onDate(today)}>
          היום
        </Chip>
        <Chip active={date === tomorrow} onClick={() => onDate(tomorrow)}>
          מחר
        </Chip>
        {allowNoDate && (
          <Chip
            active={!date}
            onClick={() => {
              onDate("");
              onTime("");
            }}
          >
            בלי תאריך
          </Chip>
        )}
      </div>
      {(date || !allowNoDate) && (
        <div className="flex items-center gap-2">
          <PickerBox id={`${idPrefix}-time`} type="time" value={time} onChange={onTime} label="בחירת שעה" icon={<Icon.Clock size={20} />} className="flex-1">
            {time ? <span className="ltr-nums text-lg">{time}</span> : <span className="text-muted">{allowNoTime ? "בלי שעה · הקישו להוספה" : "הקישו לבחירת שעה"}</span>}
          </PickerBox>
          {allowNoTime && time && (
            <button type="button" className="min-h-12 shrink-0 rounded-xl px-3 text-sm font-medium text-accent-strong underline underline-offset-4" onClick={() => onTime("")}>
              בלי שעה
            </button>
          )}
        </div>
      )}
      {hint && <p className="text-sm text-muted">{hint}</p>}
    </fieldset>
  );
}

function PickerBox({
  id,
  type,
  value,
  onChange,
  label,
  icon,
  children,
  className,
}: {
  id: string;
  type: "date" | "time";
  value: string;
  onChange: (v: string) => void;
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("relative flex min-h-12 min-w-0 items-center gap-2.5 rounded-xl border border-line bg-surface px-3.5 focus-within:border-accent", className)}>
      <span className="shrink-0 text-accent">{icon}</span>
      <span className="min-w-0 flex-1">{children}</span>
      <input
        id={id}
        type={type}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => {
          try {
            e.currentTarget.showPicker?.();
          } catch {}
        }}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
      />
    </div>
  );
}
