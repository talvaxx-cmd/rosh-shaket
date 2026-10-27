"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { Button, Card, Chip, Empty, Field, Icon, Notice, PageHeader, SectionTitle, inputClass } from "@/components/ui";
import { agendaForDay } from "@/lib/domain/agenda";
import { applyPlanOp, applyReplanOp, replanAfterDisruption, type Disruption, type ReplanDiff } from "@/lib/domain/disruption";
import { planDay, type Placement } from "@/lib/domain/planner";
import { newId } from "@/lib/domain/store-core";
import { useActions, useAppState, useNow } from "@/lib/client/store";
import { addDaysYmd, formatDurationHe, hmToMinutes, minutesToHm, toHm, toYmd, zonedToInstant } from "@/lib/time";

function Slot({ start, end, tz }: { start: string; end: string; tz: string }) {
  return (
    <span className="ltr-nums">
      {toHm(new Date(start), tz)}–{toHm(new Date(end), tz)}
    </span>
  );
}

function PlanMode() {
  const state = useAppState();
  const actions = useActions();
  const router = useRouter();
  const now = useNow(60_000);
  const tz = state.prefs.timeZone;
  const today = toYmd(now, tz);
  const [ymd, setYmd] = useState(today);
  const plan = useMemo(() => planDay(state, ymd, { now, keepScheduled: true }), [state, ymd, now]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const chosen = plan.placements.filter((p) => !excluded.has(p.taskId));
  const fixed = agendaForDay(state, ymd, tz);

  const apply = () => {
    actions.run(applyPlanOp(state, chosen, newId("plan"), new Date()), `שובצו ${chosen.length} משימות`);
    router.push(ymd === today ? "/" : `/?d=${ymd}`);
  };

  return (
    <>
      <PageHeader title="תכנן לי את היום" subtitle="הצעה בלבד — שום דבר לא משתנה עד שתאשרו. פגישות קבועות לא זזות." />
      <div className="mb-4 flex gap-2" role="group" aria-label="יום לתכנון">
        <Chip active={ymd === today} onClick={() => setYmd(today)}>היום</Chip>
        <Chip active={ymd === addDaysYmd(today, 1)} onClick={() => setYmd(addDaysYmd(today, 1))}>מחר</Chip>
      </div>

      <Card className="mb-4">
        <p>
          זמן פנוי: <strong>{formatDurationHe(Math.max(0, plan.freeMinutes))}</strong> · נדרש למשימות: <strong>{formatDurationHe(plan.neededMinutes)}</strong>
        </p>
        <p className="text-sm text-muted">
          בשעות {state.prefs.dayStart}–{state.prefs.dayEnd}, עם מרווח של {state.prefs.bufferMin} דק׳ בין התחייבויות.{" "}
          <Link href="/settings" className="underline underline-offset-4">שינוי</Link>
        </p>
      </Card>

      {plan.overloaded && (
        <Notice tone="danger" title="אין מספיק זמן לכל מה שחייב לקרות">
          <p>לא נציג תוכנית שלא באמת אפשרית. כדאי להחליט מה לדחות, לקצר או להעביר:</p>
          <ul className="mt-1 list-disc ps-5">
            {plan.unplaced.filter((u) => u.dueToday).map((u) => (
              <li key={u.taskId}>
                <Link href={`/item/${u.taskId}`} className="underline underline-offset-4">{u.title}</Link> — {u.reason}
              </li>
            ))}
          </ul>
        </Notice>
      )}

      <SectionTitle hint={plan.placements.length ? `${chosen.length} מתוך ${plan.placements.length} נבחרו` : undefined}>שיבוץ מוצע</SectionTitle>
      {plan.placements.length === 0 ? (
        <Empty>{plan.unplaced.length ? "לא נמצא חלון מתאים למשימות הפתוחות." : "אין משימות פתוחות לשבץ."}</Empty>
      ) : (
        <ul className="grid gap-2">
          {plan.placements.map((p: Placement) => {
            const on = !excluded.has(p.taskId);
            return (
              <li key={p.taskId}>
                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      setExcluded((s) => {
                        const n = new Set(s);
                        if (on) n.add(p.taskId);
                        else n.delete(p.taskId);
                        return n;
                      })
                    }
                    className="mt-1.5 h-5 w-5 accent-[var(--color-accent)]"
                  />
                  <span className="flex-1">
                    <span className="flex justify-between gap-2">
                      <span className="font-medium">{p.title}</span>
                      <span className="text-muted"><Slot start={p.start} end={p.end} tz={tz} /></span>
                    </span>
                    <span className="block text-sm text-muted">{p.reason}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {plan.unplaced.filter((u) => !u.dueToday).length > 0 && (
        <>
          <SectionTitle>לא נכנסו הפעם</SectionTitle>
          <ul className="grid gap-1 text-muted">
            {plan.unplaced.filter((u) => !u.dueToday).map((u) => (
              <li key={u.taskId}>
                {u.title} — {u.reason}
              </li>
            ))}
          </ul>
        </>
      )}

      {fixed.filter((f) => f.type === "event").length > 0 && (
        <details className="mt-5">
          <summary className="cursor-pointer text-muted">התחייבויות קבועות ביום הזה ({fixed.filter((f) => f.type === "event").length})</summary>
          <ul className="mt-2 grid gap-1">
            {fixed.filter((f) => f.type === "event").map((f) => (
              <li key={f.id + f.start} className="flex gap-2">
                <span className="text-muted"><Slot start={f.start} end={f.end} tz={tz} /></span>
                {f.type === "event" ? f.occ.title : ""}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="sticky bottom-24 mt-6 flex gap-2 rounded-3xl border border-line bg-surface/95 p-3 shadow-lg backdrop-blur">
        <Button variant="primary" size="lg" className="flex-1" disabled={chosen.length === 0} onClick={apply}>
          <Icon.Check /> אישור התוכנית
        </Button>
        <Button size="lg" onClick={() => router.back()}>
          לא עכשיו
        </Button>
      </div>
    </>
  );
}

function DisruptMode() {
  const state = useAppState();
  const actions = useActions();
  const router = useRouter();
  const now = useNow(60_000);
  const tz = state.prefs.timeZone;
  const today = toYmd(now, tz);
  const nowHm = toHm(now, tz);
  const events = agendaForDay(state, today, tz).filter((e) => e.type === "event");

  const [items, setItems] = useState<Disruption[]>([]);
  const [lateUntil, setLateUntil] = useState(minutesToHm(Math.ceil((hmToMinutes(nowHm) + 30) / 15) * 15));
  const [extEvent, setExtEvent] = useState<string>("");
  const [extMinutes, setExtMinutes] = useState(30);
  const [busyFrom, setBusyFrom] = useState(nowHm);
  const [busyTo, setBusyTo] = useState(minutesToHm(hmToMinutes(nowHm) + 60));
  const [diff, setDiff] = useState<ReplanDiff | null>(null);

  const add = (d: Disruption) => {
    setItems((x) => [...x, d]);
    setDiff(null);
  };

  const describe = (d: Disruption) => {
    if (d.type === "lateStart") return `התחלה מאוחרת — זמין רק מ־${toHm(new Date(d.until), tz)}`;
    if (d.type === "extended") return `פגישה התארכה ב־${formatDurationHe(d.minutes)}`;
    return `לא זמין ${toHm(new Date(d.start), tz)}–${toHm(new Date(d.end), tz)}`;
  };

  const apply = () => {
    if (!diff) return;
    actions.run(applyReplanOp(state, diff, newId("replan"), new Date()), "התוכנית עודכנה");
    router.push("/");
  };

  return (
    <>
      <PageHeader title="תכנון מחדש" subtitle="משהו השתנה? ספרו מה — נציע מה להשאיר, להזיז או לדחות. פגישות קבועות לא זזות." />

      <div className="grid gap-3">
        <Card className="grid gap-2">
          <p className="font-medium">התחלתי מאוחר</p>
          <div className="flex items-end gap-2">
            <Field label="זמין מ־" htmlFor="late">
              <input id="late" type="time" className={`${inputClass} ltr-nums`} value={lateUntil} onChange={(e) => setLateUntil(e.target.value)} />
            </Field>
            <Button onClick={() => add({ type: "lateStart", until: zonedToInstant(today, lateUntil, tz).toISOString() })}>הוספה</Button>
          </div>
        </Card>

        <Card className="grid gap-2">
          <p className="font-medium">פגישה התארכה</p>
          {events.length === 0 ? (
            <p className="text-sm text-muted">אין היום פגישות ביומן.</p>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="איזו" htmlFor="ext">
                <select id="ext" className={inputClass} value={extEvent} onChange={(e) => setExtEvent(e.target.value)}>
                  <option value="">בחירה…</option>
                  {events.map((e) => (
                    <option key={e.id + e.start} value={`${e.id}|${e.end}`}>
                      {e.type === "event" ? e.occ.title : ""} ({toHm(new Date(e.start), tz)})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="בכמה" htmlFor="extm">
                <select id="extm" className={inputClass} value={extMinutes} onChange={(e) => setExtMinutes(Number(e.target.value))}>
                  {[15, 30, 45, 60, 90].map((m) => (
                    <option key={m} value={m}>{formatDurationHe(m)}</option>
                  ))}
                </select>
              </Field>
              <Button
                disabled={!extEvent}
                onClick={() => {
                  const [eventId, end] = extEvent.split("|");
                  add({ type: "extended", eventId: eventId!, occurrenceEnd: end!, minutes: extMinutes });
                }}
              >
                הוספה
              </Button>
            </div>
          )}
        </Card>

        <Card className="grid gap-2">
          <p className="font-medium">זמן שאינו זמין</p>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="מ־" htmlFor="bf">
              <input id="bf" type="time" className={`${inputClass} ltr-nums`} value={busyFrom} onChange={(e) => setBusyFrom(e.target.value)} />
            </Field>
            <Field label="עד" htmlFor="bt">
              <input id="bt" type="time" className={`${inputClass} ltr-nums`} value={busyTo} onChange={(e) => setBusyTo(e.target.value)} />
            </Field>
            <Button
              disabled={busyTo <= busyFrom}
              onClick={() => add({ type: "unavailable", start: zonedToInstant(today, busyFrom, tz).toISOString(), end: zonedToInstant(today, busyTo, tz).toISOString() })}
            >
              הוספה
            </Button>
          </div>
        </Card>
      </div>

      {items.length > 0 && (
        <>
          <SectionTitle>מה קרה</SectionTitle>
          <ul className="grid gap-1">
            {items.map((d, i) => (
              <li key={i} className="flex items-center justify-between rounded-xl bg-sunken px-3 py-2">
                {describe(d)}
                <button type="button" aria-label="הסרה" className="rounded-full p-2 hover:bg-line" onClick={() => { setItems((x) => x.filter((_, j) => j !== i)); setDiff(null); }}>
                  <Icon.X size={16} />
                </button>
              </li>
            ))}
          </ul>
          <Button variant="primary" size="lg" className="mt-3 w-full" onClick={() => setDiff(replanAfterDisruption(state, today, items, new Date()))}>
            <Icon.Plan /> להציע סדר חדש
          </Button>
        </>
      )}

      {diff && (
        <>
          <SectionTitle>לפני ואחרי</SectionTitle>
          {diff.overloaded && (
            <Notice tone="danger" title="לא הכול נכנס">
              משימות עם מועד להיום לא נכנסות. כדאי להחליט עליהן — לא נציג תוכנית בלתי אפשרית.
            </Notice>
          )}
          <div className="mt-2 grid gap-2">
            {diff.moved.map((m) => (
              <Card key={m.taskId}>
                <p className="font-medium">{m.title}</p>
                <p className="text-sm">
                  <span className="text-muted line-through"><Slot start={m.from.start} end={m.from.end} tz={tz} /></span>
                  {" ← "}
                  <strong><Slot start={m.start} end={m.end} tz={tz} /></strong>
                </p>
              </Card>
            ))}
            {diff.added.map((m) => (
              <Card key={m.taskId}>
                <p className="font-medium">{m.title}</p>
                <p className="text-sm">ישובץ <strong><Slot start={m.start} end={m.end} tz={tz} /></strong></p>
              </Card>
            ))}
            {diff.postponed.map((p) => (
              <Card key={p.taskId} className={p.dueToday ? "border-danger/25" : undefined}>
                <p className="font-medium">{p.title}</p>
                <p className={`text-sm ${p.dueToday ? "text-danger" : "text-muted"}`}>{p.reason}</p>
              </Card>
            ))}
            {diff.kept.length > 0 && <p className="text-sm text-muted">נשארות במקומן: {diff.kept.map((k) => k.title).join(", ")}</p>}
            {diff.moved.length + diff.added.length + diff.postponed.length === 0 && <Empty>אין צורך לשנות דבר — התוכנית עדיין מסתדרת.</Empty>}
          </div>
          <div className="sticky bottom-24 mt-4 flex gap-2 rounded-3xl border border-line bg-surface/95 p-3 shadow-lg backdrop-blur">
            <Button variant="primary" size="lg" className="flex-1" disabled={diff.moved.length + diff.added.length + diff.postponed.length === 0} onClick={apply}>
              <Icon.Check /> להחיל את השינוי
            </Button>
            <Button size="lg" onClick={() => setDiff(null)}>
              לא
            </Button>
          </div>
        </>
      )}
    </>
  );
}

function PlanInner() {
  const params = useSearchParams();
  return params.get("mode") === "disrupt" ? <DisruptMode /> : <PlanMode />;
}

export default function PlanPage() {
  return (
    <Suspense>
      <PlanInner />
    </Suspense>
  );
}
