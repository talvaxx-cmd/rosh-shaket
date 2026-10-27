"use client";

/**
 * Browser notifications. Honest about limits: a web app can only *hand* a
 * notification to the system — it can't know it was delivered or seen, and
 * timers run only while the app is open (or recently backgrounded). Reliable
 * background delivery needs Web Push from a server (next phase).
 */

export type PermissionState = "granted" | "denied" | "default" | "unsupported";

export function notificationPermission(): PermissionState {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<PermissionState> {
  if (notificationPermission() === "unsupported") return "unsupported";
  try {
    return await Notification.requestPermission();
  } catch {
    return notificationPermission();
  }
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return null;
  }
}

export interface ShowArgs {
  title: string;
  body: string;
  tag: string;
  url: string;
  reminderId?: string;
  actions?: boolean;
}

/** Returns true when the notification was handed to the system (not a delivery guarantee). */
export async function showNotification(a: ShowArgs): Promise<boolean> {
  if (notificationPermission() !== "granted") return false;
  const options: NotificationOptions & { actions?: { action: string; title: string }[] } = {
    body: a.body,
    tag: a.tag,
    lang: "he",
    dir: "rtl",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: a.url, reminderId: a.reminderId },
  };
  if (a.actions) {
    options.actions = [
      { action: "done", title: "בוצע" },
      { action: "snooze", title: "דחה ב־10 דק׳" },
    ];
  }
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(a.title, options);
      return true;
    }
    // Page-level notifications can't carry action buttons.
    const { actions: _actions, ...plain } = options;
    void _actions;
    new Notification(a.title, plain);
    return true;
  } catch {
    return false;
  }
}
