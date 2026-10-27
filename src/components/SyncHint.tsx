"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { isStandalone } from "@/lib/client/push";
import { isAppleMobile } from "@/lib/client/speech";
import { useSync } from "@/lib/client/sync";
import { Icon } from "./ui";

const KEY = "rosh-shaket:sync-hint-dismissed";

/**
 * On iPhone, the Home Screen app and Safari keep separate data. Without sync,
 * something added in one "disappears" in the other — say so, once, with the fix.
 */
export function SyncHint() {
  const sync = useSync();
  const [show, setShow] = useState(false);
  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(KEY) === "1";
    } catch {}
    setShow(!dismissed && isAppleMobile());
  }, []);
  if (!show || sync.linked) return null;
  return (
    <div className="mt-3 flex items-start gap-2 rounded-xl border border-warn-line bg-warn-soft p-3 text-[0.95rem] text-warn">
      <Icon.Alert size={18} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{isStandalone() ? "האפליקציה שעל מסך הבית שומרת בנפרד מספארי" : "ספארי והאפליקציה שעל מסך הבית שומרים בנפרד"}</p>
        <p>כדי שכל מה שתוסיפו יופיע בכל מקום — הפעילו סנכרון.</p>
        <div className="mt-2 flex gap-3">
          <Link href="/settings#sync" className="font-bold underline underline-offset-4">
            הפעלת סנכרון
          </Link>
          <button
            type="button"
            className="font-medium"
            onClick={() => {
              try {
                localStorage.setItem(KEY, "1");
              } catch {}
              setShow(false);
            }}
          >
            לא עכשיו
          </button>
        </div>
      </div>
    </div>
  );
}
