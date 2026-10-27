"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useSpeech } from "@/lib/client/speech";
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

/**
 * The center button records right away: the tap itself starts the microphone
 * (browsers only allow that from a direct tap), then the Add screen opens and
 * shows the words as they're heard. A second tap stops.
 */
function MicButton() {
  const speech = useSpeech();
  const router = useRouter();
  const pathname = usePathname();
  const onAdd = pathname.startsWith("/add");

  const onClick = () => {
    if (speech.recording) {
      speech.stop();
      return;
    }
    if (speech.status === "stopping" || speech.status === "transcribing") {
      if (!onAdd) router.push("/add");
      return;
    }
    if (speech.supported) speech.start();
    if (!onAdd) router.push("/add");
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={speech.recording}
      aria-label={speech.recording ? "עצירת ההקלטה" : "הקלטה — לומר מה צריך"}
      className={cx(
        // Large hit area: the circle plus its label.
        "flex min-h-20 w-full min-w-0 touch-manipulation select-none flex-col items-center justify-start gap-1 rounded-2xl",
      )}
    >
      <span
        className={cx(
          "flex h-[3.25rem] w-[3.25rem] items-center justify-center rounded-full text-on-accent shadow-lg ring-4 ring-bg transition-colors",
          speech.recording ? "recording-pulse bg-accent-strong" : "bg-accent active:bg-accent-strong",
        )}
      >
        {speech.recording ? <Icon.Stop size={24} /> : <Icon.Mic size={26} />}
      </span>
      <span className={cx("max-w-full truncate text-[0.8rem] leading-none", speech.recording ? "font-semibold text-accent-strong" : "text-muted")}>
        {speech.recording ? "עצירה" : speech.status === "transcribing" ? "מתמלל…" : "הוספה בקול"}
      </span>
    </button>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const state = useAppState();
  const onboarding = pathname.startsWith("/onboarding");
  // Linking a new device doesn't require going through the intro first.
  const linking = pathname.startsWith("/link");

  useEffect(() => {
    if (!state.prefs.onboarded && !onboarding && !linking) router.replace("/onboarding");
  }, [state.prefs.onboarded, onboarding, linking, router]);

  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:right-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:p-3">
        דילוג לתוכן
      </a>
      <main id="main" className={cx("mx-auto w-full max-w-2xl px-5 pt-4", onboarding ? "pb-10" : "pb-36")}>
        {children}
      </main>
      {!onboarding && (
        <nav aria-label="ניווט ראשי" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[max(env(safe-area-inset-bottom),0.5rem)] backdrop-blur">
          <ul className="mx-auto grid max-w-2xl grid-cols-5 items-end px-1">
            {NAV.map(({ href, label, icon: I, primary }) => {
              const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
              if (primary) {
                return (
                  <li key={href} className="-mt-4 flex min-w-0 justify-center">
                    <MicButton />
                  </li>
                );
              }
              return (
                <li key={href} className="min-w-0">
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cx(
                      "flex min-h-16 w-full touch-manipulation flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[0.8rem]",
                      active ? "font-semibold text-accent-strong" : "text-muted hover:text-ink",
                    )}
                  >
                    <I size={22} className="shrink-0" />
                    <span className="max-w-full truncate">{label}</span>
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
