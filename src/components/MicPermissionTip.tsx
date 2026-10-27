"use client";

import { useEffect, useState } from "react";
import { isAppleMobile } from "@/lib/client/speech";

const KEY = "rosh-shaket:mic-tip-dismissed";

/**
 * Safari decides how often to ask for the microphone per website; a web page
 * can't make the answer permanent by itself. This explains the one-time setting.
 */
export function MicPermissionTip({ forceOpen = false }: { forceOpen?: boolean }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isAppleMobile()) return;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(KEY) === "1";
    } catch {}
    if (dismissed && !forceOpen) return;
    // Already allowed permanently → nothing to explain.
    const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
    if (!perms || forceOpen) {
      setShow(true);
      return;
    }
    perms
      .query({ name: "microphone" as PermissionName })
      .then((st) => setShow(st.state !== "granted"))
      .catch(() => setShow(true));
  }, [forceOpen]);

  if (!show) return null;
  return (
    <div className="w-full rounded-2xl border border-line bg-surface p-4 text-[0.98rem]">
      <p className="font-medium">שהאייפון לא ישאל כל פעם על המיקרופון</p>
      <p className="mt-1 text-muted">ספארי שואל לפי ההגדרה שלו לכל אתר. מגדירים פעם אחת:</p>
      <ol className="mt-2 list-decimal space-y-1 ps-5">
        <li>בשורת הכתובת של ספארי לוחצים על סמל ההגדרות (‏<span dir="ltr">aA</span> או ⋯).</li>
        <li>בוחרים <strong>הגדרות אתר</strong> (Website Settings).</li>
        <li>
          ב<strong>מיקרופון</strong> בוחרים <strong>אפשר</strong> (Allow).
        </li>
      </ol>
      <p className="mt-2 text-sm text-muted">
        אפשר גם להגדיר לכל האתרים: הגדרות ← אפליקציות ← Safari ← מיקרופון ← אפשר.
      </p>
      <button
        type="button"
        className="mt-2 min-h-10 font-medium text-accent-strong"
        onClick={() => {
          try {
            localStorage.setItem(KEY, "1");
          } catch {}
          setShow(false);
        }}
      >
        הבנתי, סגירה
      </button>
    </div>
  );
}
