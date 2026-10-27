"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { Button, Card, Chip, Empty, Field, Icon, KindBadge, Notice, PageHeader, inputClass } from "@/components/ui";
import { conflictsWith, taskDueYmd } from "@/lib/domain/agenda";
import { describeRecurrenceHe, occurrencesInRange } from "@/lib/domain/recurrence";
import { reminderLabelHe } from "@/lib/domain/reminders";
import {
  cancelOccurrenceOp,
  completeTaskOp,
  deleteItemOp,
  editRecurringEventOp,
  newId,
  remindersFor,
  touch,
  type RecurringScope,
} from "@/lib/domain/store-core";
import type { CalendarEvent, Importance, Reminder, Task, Unresolved } from "@/lib/domain/types";
import { useActions, useAppState } from "@/lib/client/store";
import { addDaysYmd, formatDurationHe, formatYmdHe, isYmd, minutesBetween, startOfDay, toHm, toYmd, zonedToInstant } from "@/lib/time";

const REMINDER_CHOICES = [0, 10, 30, 60, 1440];

function ScopePicker({ onPick, onCancel, verb }: { onPick: (s: RecurringScope) => void; onCancel: () => void; verb: string }) {
  return (
    <Card className="border-accent">
      <p className="mb-3 font-semibold">זה אירוע חוזר. {verb} את:</p>
      <div className="grid gap-2">
        <Button onClick={() => onPick("this")}>המופע הזה בלבד</Button>
        <Button onClick={() => onPick("following")}>המופע הזה וכל הבאים</Button>
        <Button onClick={() => onPick("all")}>כל הסדרה</Button>
        <Button variant="ghost" onClick={onCancel}>
          ביטול
        </Button>
      </div>
    </Card>
  );
}

function RemindersEditor({ target, kind, tz }: { target: CalendarEvent | Task; kind: "event" | "task"; tz: string }) {
  const state = useAppState();
  const actions = useActions();
  const list = remindersFor(state, target.id);
  const minutesOn = new Set(list.map((r) => (r.rule.type === "before" ? r.rule.minutes : -1)));
  const toggle = (m: number) => {
    const now = new Date();
    const existing = list.find((r) => r.rule.type === "before" && r.rule.minutes === m);
    if (existing) {
      actions.run({ opId: newId("op"), label: "הסרת תזכורת", source: "manual", remove: [existing.id] });
    } else {
      const r: Reminder = {
        id: newId("r"),
        kind: "reminder",
        target: { kind, id: target.id },
        rule: { type: "before", minutes: m },
        channel: "notification",
        state: "pending",
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      actions.run({ opId: newId("op"), label: "נוספה תזכורת", source: "manual", put: [r] });
    }
  };
  return (
    <fieldset className="mt-4">
      <legend className="mb-2 flex items-center gap-1 font-medium">
        <Icon.Bell size={18} /> תזכורות
      </legend>
      <div className="flex flex-wrap gap-2">
        {REMINDER_CHOICES.map((m) => (
          <Chip key={m} active={minutesOn.has(m)} onClick={() => toggle(m)}>
            {reminderLabelHe({ rule: { type: "before", minutes: m } } as Reminder, tz)}
          </Chip>
        ))}
      </div>
      {list.some((r) => r.lastShownAt) && (
        <p className="mt-2 text-sm text-faint">
          הוצגה לאחרונה: {list.filter((r) => r.lastShownAt).map((r) => toHm(new Date(r.lastShownAt!), tz)).join(", ")} (נמסרה למערכת; אין אישור שנראתה)
        </p>
      )}
    </fieldset>
  );
}

/** A detail was guessed when saving; confirm it, or edit below. */
function UnsureBanner({ item }: { item: CalendarEvent | Task }) {
  const actions = useActions();
  if (!item.unsure) return null;
  return (
    <div className="mb-3">
      <Notice tone="warn" title="כדאי לבדוק">
        <p>{item.unsure}. אם זה נכון — מאשרים. אם לא — עורכים למטה.</p>
        <Button
          size="sm"
          variant="primary"
          className="mt-2"
          onClick={() => actions.run({ opId: newId("op"), label: `אושר: ${item.title}`, source: "manual", put: [touch(item, new Date(), { unsure: undefined })] }, "אושר")}
        >
          <Icon.Check size={18} /> זה נכון
        </Button>
      </Notice>
    </div>
  );
}

function EventView({ ev, occKey }: { ev: CalendarEvent; occKey: string | null }) {
  const state = useAppState();
  const actions = useActions();
  const router = useRouter();
  const tz = state.prefs.timeZone;

  const occ = useMemo(() => {
    if (!ev.recurrence || !occKey) return null;
    const day = startOfDay(occKey, ev.timeZone);
    return occurrencesInRange(ev, new Date(day.getTime() - 86400000), new Date(day.getTime() + 2 * 86400000)).find((o) => o.key === occKey) ?? null;
  }, [ev, occKey]);

  const start = occ?.start ?? ev.start;
  const end = occ?.end ?? ev.end;
  const key = occ?.key ?? toYmd(new Date(ev.start), ev.timeZone);

  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(occ?.title ?? ev.title);
  const [date, setDate] = useState(toYmd(new Date(start), tz));
  const [time, setTime] = useState(toHm(new Date(start), tz));
  const [duration, setDuration] = useState(minutesBetween(start, end));
  const [location, setLocation] = useState(occ?.location ?? ev.location ?? "");
  const [askScope, setAskScope] = useState<null | "edit" | "delete">(null);

  const newStart = isYmd(date) && time ? zonedToInstant(date, time, tz).toISOString() : start;
  const newEnd = new Date(new Date(newStart).getTime() + duration * 60000).toISOString();
  const clashes = editing ? conflictsWith(state, { start: newStart, end: newEnd }, ev.id) : [];

  const doEdit = (scope: RecurringScope) => {
    const op = editRecurringEventOp({ ...ev, unsure: undefined }, key, start, { title, location: location || undefined, start: newStart, end: newEnd }, scope, newId("op"), new Date());
    actions.run(op, "עודכן");
    setAskScope(null);
    setEditing(false);
  };
  const doDelete = (scope: RecurringScope) => {
    actions.run(cancelOccurrenceOp(state, ev, key, scope, newId("op"), new Date()), "נמחק");
    router.push("/");
  };

  const zoneDiffers = ev.timeZone !== tz;

  return (
    <>
      <PageHeader title={occ?.title ?? ev.title} subtitle={<KindBadge kind="event" />} />
      <UnsureBanner item={ev} />
      <Card>
        <dl className="grid gap-2">
          <div>
            <dt className="text-sm text-muted">מתי</dt>
            <dd className="text-lg">
              {formatYmdHe(toYmd(new Date(start), tz), { withYear: true })} ·{" "}
              <span className="ltr-nums">
                {toHm(new Date(start), tz)}–{toHm(new Date(end), tz)}
              </span>
            </dd>
            {zoneDiffers && (
              <dd className="text-sm text-muted">
                נקבע לפי {ev.timeZone}: <span className="ltr-nums">{toHm(new Date(start), ev.timeZone)}</span> שעון מקומי שם
              </dd>
            )}
          </div>
          {(occ?.location ?? ev.location) && (
            <div>
              <dt className="text-sm text-muted">מקום</dt>
              <dd className="flex items-center gap-1">
                <Icon.Pin size={18} /> {occ?.location ?? ev.location}
              </dd>
            </div>
          )}
          {ev.recurrence && (
            <div>
              <dt className="text-sm text-muted">חזרתיות</dt>
              <dd className="flex items-center gap-1">
                <Icon.Repeat size={18} /> {describeRecurrenceHe(ev.recurrence)}
              </dd>
            </div>
          )}
          {ev.notes && (
            <div>
              <dt className="text-sm text-muted">הערות</dt>
              <dd>{ev.notes}</dd>
            </div>
          )}
        </dl>
        <RemindersEditor target={ev} kind="event" tz={tz} />
      </Card>

      {editing && (
        <Card className="mt-4 grid gap-3">
          <Field label="כותרת" htmlFor="t">
            <input id="t" className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="תאריך" htmlFor="d">
              <input id="d" type="date" className={`${inputClass} ltr-nums`} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="שעה" htmlFor="h">
              <input id="h" type="time" className={`${inputClass} ltr-nums`} value={time} onChange={(e) => setTime(e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="משך (דקות)" htmlFor="dur" hint={formatDurationHe(duration)}>
              <input id="dur" type="number" min={5} step={5} className={`${inputClass} ltr-nums`} value={duration} onChange={(e) => setDuration(Math.max(5, Number(e.target.value) || 5))} />
            </Field>
            <Field label="מקום" htmlFor="loc">
              <input id="loc" className={inputClass} value={location} onChange={(e) => setLocation(e.target.value)} />
            </Field>
          </div>
          {clashes.map((c) => (
            <Notice key={`${c.eventId}${c.key}`} tone="danger">
              חופף ל״{c.title}״ (<span className="ltr-nums">{toHm(new Date(c.start), tz)}–{toHm(new Date(c.end), tz)}</span>)
            </Notice>
          ))}
          {askScope === "edit" ? (
            <ScopePicker verb="לעדכן" onPick={doEdit} onCancel={() => setAskScope(null)} />
          ) : (
            <div className="flex gap-2">
              <Button variant="primary" className="flex-1" onClick={() => (ev.recurrence ? setAskScope("edit") : doEdit("all"))}>
                שמירת שינויים
              </Button>
              <Button onClick={() => setEditing(false)}>ביטול</Button>
            </div>
          )}
        </Card>
      )}

      {!editing && askScope !== "delete" && (
        <div className="mt-4 flex gap-2">
          <Button variant="primary" className="flex-1" onClick={() => setEditing(true)}>
            עריכה
          </Button>
          <Button variant="danger" onClick={() => (ev.recurrence ? setAskScope("delete") : doDelete("all"))}>
            מחיקה
          </Button>
        </div>
      )}
      {askScope === "delete" && (
        <div className="mt-4">
          <ScopePicker verb="למחוק" onPick={doDelete} onCancel={() => setAskScope(null)} />
        </div>
      )}
      <p className="mt-4 text-sm text-faint">
        מקור: {ev.source === "voice" ? "הזנה קולית" : ev.source === "text" ? "הזנה בטקסט" : "ידני"} · נוצר {toYmd(new Date(ev.createdAt), tz).split("-").reverse().join(".")}
      </p>
    </>
  );
}

function TaskView({ task }: { task: Task }) {
  const state = useAppState();
  const actions = useActions();
  const router = useRouter();
  const tz = state.prefs.timeZone;
  const dueDate = taskDueYmd(task, tz) ?? "";
  const [title, setTitle] = useState(task.title);
  const [date, setDate] = useState(dueDate);
  const [time, setTime] = useState(task.due && !task.dueIsDateOnly ? toHm(new Date(task.due), tz) : "");
  const [duration, setDuration] = useState<number | "">(task.durationMin ?? "");
  const [importance, setImportance] = useState<Importance>(task.importance);
  const prepEvent = task.prepFor ? (state.items[task.prepFor] as CalendarEvent | undefined) : undefined;

  const dirty =
    title !== task.title ||
    date !== dueDate ||
    time !== (task.due && !task.dueIsDateOnly ? toHm(new Date(task.due), tz) : "") ||
    duration !== (task.durationMin ?? "") ||
    importance !== task.importance;

  const save = () => {
    let due: string | undefined;
    let dueIsDateOnly: boolean | undefined;
    if (date && time) due = zonedToInstant(date, time, tz).toISOString();
    else if (date) {
      due = zonedToInstant(addDaysYmd(date, 1), "00:00", tz).toISOString();
      dueIsDateOnly = true;
    }
    actions.run(
      {
        opId: newId("op"),
        label: `עדכון: ${title}`,
        source: "manual",
        put: [
          touch(task, new Date(), {
            unsure: undefined,
            title,
            due,
            dueIsDateOnly,
            durationMin: duration === "" ? undefined : duration,
            durationAssumed: undefined,
            importance,
          }),
        ],
      },
      "עודכן",
    );
  };

  return (
    <>
      <PageHeader title={task.title} subtitle={<KindBadge kind="task" />} />
      <UnsureBanner item={task} />
      {task.status === "done" && <Notice>המשימה בוצעה{task.completedAt ? ` ב־${toHm(new Date(task.completedAt), tz)}` : ""}.</Notice>}
      <Card className="mt-3 grid gap-3">
        <Field label="כותרת" htmlFor="t">
          <input id="t" className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="מועד אחרון" htmlFor="d">
            <input id="d" type="date" className={`${inputClass} ltr-nums`} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="עד שעה" htmlFor="h">
            <input id="h" type="time" className={`${inputClass} ltr-nums`} value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="משך משוער (דקות)" htmlFor="dur" hint={task.durationAssumed ? "הערכה — אפשר לעדכן" : undefined}>
            <input id="dur" type="number" min={5} step={5} className={`${inputClass} ltr-nums`} value={duration} placeholder="לא ידוע" onChange={(e) => setDuration(e.target.value ? Math.max(5, Number(e.target.value)) : "")} />
          </Field>
          <Field label="חשיבות" htmlFor="imp">
            <select id="imp" className={inputClass} value={importance} onChange={(e) => setImportance(e.target.value as Importance)}>
              <option value="low">נמוכה</option>
              <option value="normal">רגילה</option>
              <option value="high">גבוהה</option>
            </select>
          </Field>
        </div>
        {task.scheduled && (
          <p className="text-muted">
            משובצת: {formatYmdHe(toYmd(new Date(task.scheduled.start), tz))} ·{" "}
            <span className="ltr-nums">
              {toHm(new Date(task.scheduled.start), tz)}–{toHm(new Date(task.scheduled.end), tz)}
            </span>{" "}
            <button
              type="button"
              className="font-medium text-accent-strong underline underline-offset-4"
              onClick={() => actions.run({ opId: newId("op"), label: "הסרת שיבוץ", source: "manual", put: [touch(task, new Date(), { scheduled: undefined })] })}
            >
              הסרת שיבוץ
            </button>
          </p>
        )}
        {prepEvent && <p className="text-muted">הכנה לקראת ״{prepEvent.title}״ — תשובץ לפני תחילתו.</p>}
        {dirty && (
          <Button variant="primary" onClick={save}>
            שמירת שינויים
          </Button>
        )}
        {task.due && !task.dueIsDateOnly && <RemindersEditor target={task} kind="task" tz={tz} />}
      </Card>
      <div className="mt-4 flex gap-2">
        <Button variant="primary" className="flex-1" onClick={() => actions.run(completeTaskOp(task, task.status !== "done", newId("op"), new Date()))}>
          <Icon.Check />
          {task.status === "done" ? "החזרה לפתוחה" : "סימון כבוצעה"}
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            actions.run(deleteItemOp(state, task.id, newId("op"), new Date()), "נמחק");
            router.push("/tasks");
          }}
        >
          מחיקה
        </Button>
      </div>
    </>
  );
}

function UnresolvedView({ u }: { u: Unresolved }) {
  const state = useAppState();
  const actions = useActions();
  const router = useRouter();
  return (
    <>
      <PageHeader title="לבירור" subtitle={<KindBadge kind="unresolved" />} />
      <Card>
        <p className="text-lg">״{u.text}״</p>
        <p className="mt-2 text-warn">{u.question}</p>
      </Card>
      <div className="mt-4 flex gap-2">
        <Button
          variant="primary"
          className="flex-1"
          onClick={() => {
            actions.dispatch(deleteItemOp(state, u.id, newId("op"), new Date()));
            router.push(`/add?text=${encodeURIComponent(u.text)}`);
          }}
        >
          השלמה עכשיו
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            actions.run(deleteItemOp(state, u.id, newId("op"), new Date()), "נמחק");
            router.push("/attention");
          }}
        >
          מחיקה
        </Button>
      </div>
    </>
  );
}

function ItemInner() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const state = useAppState();
  const item = state.items[id];
  if (!item) return <Empty>הפריט לא נמצא — אולי נמחק. אפשר לשחזר מההיסטוריה.</Empty>;
  if (item.kind === "event") return <EventView key={item.updatedAt} ev={item} occKey={params.get("occ")} />;
  if (item.kind === "task") return <TaskView key={item.updatedAt} task={item} />;
  if (item.kind === "unresolved") return <UnresolvedView u={item} />;
  return <Empty>תזכורת — פתחו את הפריט שהיא שייכת אליו.</Empty>;
}

export default function ItemPage() {
  return (
    <Suspense>
      <ItemInner />
    </Suspense>
  );
}
