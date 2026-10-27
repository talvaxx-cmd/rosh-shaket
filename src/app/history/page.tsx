"use client";

import { Button, Empty, Icon, PageHeader, SectionTitle } from "@/components/ui";
import { tasks } from "@/lib/domain/store-core";
import { useActions, useAppState } from "@/lib/client/store";
import { formatYmdHe, toHm, toYmd } from "@/lib/time";

const SOURCE: Record<string, string> = {
  voice: "קולי",
  text: "טקסט",
  manual: "ידני",
  plan: "תכנון",
  calendar: "יומן",
  system: "מערכת",
  undo: "ביטול",
};

export default function HistoryPage() {
  const state = useAppState();
  const actions = useActions();
  const tz = state.prefs.timeZone;
  const entries = state.history.filter((h) => h.source !== "system");
  const done = tasks(state)
    .filter((t) => t.status === "done")
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))
    .slice(0, 30);

  let lastDay = "";
  return (
    <>
      <PageHeader title="היסטוריה" subtitle="כל שינוי משמעותי נרשם כאן, ואפשר לבטל אותו." />

      {done.length > 0 && (
        <details className="mb-4">
          <summary className="cursor-pointer font-medium">משימות שהושלמו ({done.length})</summary>
          <ul className="mt-2 grid gap-1 text-muted">
            {done.map((t) => (
              <li key={t.id} className="flex items-center gap-2">
                <Icon.Check size={16} className="text-accent" />
                {t.title}
                {t.completedAt && <span className="text-sm text-faint">· {formatYmdHe(toYmd(new Date(t.completedAt), tz), { withWeekday: false })}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {entries.length === 0 ? (
        <Empty>עדיין אין שינויים.</Empty>
      ) : (
        <ul className="grid gap-2">
          {entries.map((h) => {
            const day = toYmd(new Date(h.at), tz);
            const header = day !== lastDay ? <SectionTitle>{formatYmdHe(day)}</SectionTitle> : null;
            lastDay = day;
            return (
              <li key={h.opId}>
                {header}
                <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
                  <span className="w-12 shrink-0 text-sm text-muted ltr-nums">{toHm(new Date(h.at), tz)}</span>
                  <span className="flex-1">
                    <span className={h.undoneBy ? "text-muted line-through" : ""}>{h.label}</span>
                    <span className="block text-sm text-faint">{SOURCE[h.source] ?? h.source}{h.undoneBy && " · בוטל"}</span>
                  </span>
                  {!h.undoneBy && h.source !== "undo" && (
                    <Button size="sm" variant="ghost" onClick={() => actions.undo(h.opId)}>
                      <Icon.Undo size={18} /> ביטול
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
