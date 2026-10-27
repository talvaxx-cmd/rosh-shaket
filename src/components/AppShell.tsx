"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useActions, useAppState, useToasts } from "@/lib/client/store";
import { Icon, cx } from "./ui";
import { NotificationRunner } from "./NotificationRunner";

const NAV = [
  { href: "/", label: "היום", icon: Icon.Sun },
  { href: "/calendar", label: "יומן", icon: Icon.Calendar },
  { href: "/add", label: "הוספה", icon: Icon.Mic, primary: true },
  { href: "/tasks", label: "משימות", icon: Icon.List },
  { href: "/settings", label: "הגדרות", icon: Icon.Settings },
];

function Toasts() {
  const { toasts, dismissToast } = useToasts();
  const { undo } = useActions();
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-28 z-50 flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx(
            "toast-in pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl px-4 py-3 shadow-lg",
            t.tone === "error" ? "bg-danger text-white" : "bg-ink text-white",
          )}
        >
          <span className="flex-1">{t.text}</span>
          {t.undoOpId && (
            <button
              type="button"
              className="flex min-h-10 items-center gap-1 rounded-full px-3 font-semibold text-[#9fe3d2] hover:bg-white/10"
              onClick={() => {
                undo(t.undoOpId!);
                dismissToast(t.id);
              }}
            >
              <Icon.Undo size={18} />
              ביטול
            </button>
          )}
          <button type="button" aria-label="סגירת הודעה" className="rounded-full p-2 hover:bg-white/10" onClick={() => dismissToast(t.id)}>
            <Icon.X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const state = useAppState();
  const onboarding = pathname.startsWith("/onboarding");

  useEffect(() => {
    if (!state.prefs.onboarded && !onboarding) router.replace("/onboarding");
  }, [state.prefs.onboarded, onboarding, router]);

  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:right-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:p-3">
        דילוג לתוכן
      </a>
      <main id="main" className={cx("mx-auto w-full max-w-2xl px-4 pt-4", onboarding ? "pb-10" : "pb-36")}>
        {children}
      </main>
      {!onboarding && (
        <nav aria-label="ניווט ראשי" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
          <ul className="mx-auto flex max-w-2xl items-end justify-around px-2">
            {NAV.map(({ href, label, icon: I, primary }) => {
              const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
              if (primary) {
                return (
                  <li key={href} className="-mt-6">
                    <Link
                      href={href}
                      aria-label="הוספה בקול או בטקסט"
                      className="flex h-16 w-16 items-center justify-center rounded-full bg-accent text-on-accent shadow-lg ring-4 ring-bg hover:bg-accent-strong"
                    >
                      <I size={28} />
                    </Link>
                  </li>
                );
              }
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cx(
                      "flex min-h-16 min-w-16 flex-col items-center justify-center gap-0.5 rounded-xl px-2 text-[0.8rem]",
                      active ? "font-semibold text-accent-strong" : "text-muted hover:text-ink",
                    )}
                  >
                    <I size={22} />
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
      <Toasts />
      <NotificationRunner />
    </>
  );
}
