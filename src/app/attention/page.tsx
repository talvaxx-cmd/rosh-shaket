"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Button, Card, Empty, Icon, PageHeader, SectionTitle } from "@/components/ui";
import { taskDueYmd } from "@/lib/domain/agenda";
import { attention } from "@/lib/domain/attention";
import { completeTaskOp, newId, touch } from "@/lib/domain/store-core";
import { useActions, useAppState, useNow } from "@/lib/client/store";
import { addDaysYmd, formatYmdHe, relativeDayHe, toHm, toYmd, zonedToInstant } from "@/lib/time";

export default function AttentionPage() {
  const state = useAppState();
  const actions = useActions();
  const now = useNow();
  const tz = state.prefs.timeZone;
  const today = toYmd(now, tz);
  const a = useMemo(() => attention(state, now), [state, now]);

  return (
    <>
      <PageHeader title="דורש טיפול" subtitle="התנגשויות, איחורים ופרטים חסרים. שום דבר לא משתנה בלי החלטה שלכם." />

      {a.total === 0 && a.dueTodayUnscheduled.length === 0 && <Empty>אין כרגע משהו שמחכה להחלטה.</Empty>}

      {a.conflicts.length > 0 && (
        <>
          <SectionTitle hint="בשבועיים הקרובים">התנגשויות</SectionTitle>
          <div className="grid gap-2">
            {a.conflicts.map((c) => (
              <Card key={`${c.a.id}${c.a.key}${c.b.id}${c.b.key}`} className="border-danger/25">
                <p className="mb-2 text-sm font-medium text-danger">
                  {relativeDayHe(toYmd(new Date(c.a.start), tz), today)} — שני אירועים חופפים
                </p>
                {[c.a, c.b].map((x) => (
                  <Link key={x.id + x.key} href={`/item/${x.id}?occ=${x.key}`} className="flex items-center justify-between rounded-xl px-2 py-2 hover:bg-sunken">
                    <span className="flex items-center gap-2">
                      <Icon.Clock size={18} className="text-accent" />
                      {x.title}
                    </span>
                    <span className="text-sm text-muted ltr-nums">
                      {toHm(new Date(x.start), tz)}–{toHm(new Date(x.end), tz)}
                    </span>
                  </Link>
                ))}
                <p className="mt-1 text-sm text-muted">פתחו אחד מהם כדי להזיז, לקצר או לבטל.</p>
              </Card>
            ))}
          </div>
        </>
      )}

      {a.overdue.length > 0 && (
        <>
          <SectionTitle>באיחור</SectionTitle>
          <div className="grid gap-2">
            {a.overdue.map((t) => (
              <Card key={t.id}>
                <Link href={`/item/${t.id}`} className="font-medium">
                  {t.title}
                </Link>
                <p className="text-sm text-muted">
                  המועד היה {formatYmdHe(taskDueYmd(t, tz)!)}
                  {!t.dueIsDateOnly && <span className="ltr-nums"> {toHm(new Date(t.due!), tz)}</span>}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="primary" onClick={() => actions.run(completeTaskOp(t, true, newId("op"), new Date()), "בוצע")}>
                    <Icon.Check size={18} /> בוצע
                  </Button>
                  <Button
                    size="sm"
                    onClick={() =>
                      actions.run(
                        {
                          opId: newId("op"),
                          label: `הועבר למחר: ${t.title}`,
                          source: "manual",
                          put: [touch(t, new Date(), { due: zonedToInstant(addDaysYmd(today, 2), "00:00", tz).toISOString(), dueIsDateOnly: true, scheduled: undefined })],
                        },
                        "הועבר למחר",
                      )
                    }
                  >
                    למחר
                  </Button>
                  <Button
                    size="sm"
                    onClick={() =>
                      actions.run(
                        { opId: newId("op"), label: `הוסר מועד: ${t.title}`, source: "manual", put: [touch(t, new Date(), { due: undefined, dueIsDateOnly: undefined, scheduled: undefined })] },
                        "נשמר בלי מועד",
                      )
                    }
                  >
                    בלי מועד
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => actions.run({ opId: newId("op"), label: `ויתור: ${t.title}`, source: "manual", put: [touch(t, new Date(), { status: "dropped" })] }, "הוסר מהרשימה")}
                  >
                    לוותר
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      {a.unresolved.length > 0 && (
        <>
          <SectionTitle>לבירור</SectionTitle>
          <div className="grid gap-2">
            {a.unresolved.map((u) => (
              <Link key={u.id} href={`/item/${u.id}`} className="block rounded-[var(--radius-card)] border border-warn-line bg-warn-soft p-4">
                <span className="block">״{u.text}״</span>
                <span className="block text-sm text-warn">{u.question}</span>
              </Link>
            ))}
          </div>
        </>
      )}

      {a.dueTodayUnscheduled.length > 0 && (
        <>
          <SectionTitle>להיום, עדיין בלי זמן</SectionTitle>
          <Card>
            <ul className="grid gap-1">
              {a.dueTodayUnscheduled.map((t) => (
                <li key={t.id}>
                  <Link href={`/item/${t.id}`}>{t.title}</Link>
                </li>
              ))}
            </ul>
            <Link href="/plan" className="mt-3 inline-flex items-center gap-1 font-medium text-accent-strong">
              <Icon.Spark size={18} /> לקבל הצעת שיבוץ
            </Link>
          </Card>
        </>
      )}
    </>
  );
}
