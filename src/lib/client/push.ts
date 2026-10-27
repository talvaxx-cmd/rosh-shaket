"use client";

/**
 * Web Push on this device: reminders from the server even when the app is closed.
 * On iPhone this works only in the app added to the Home Screen (iOS 16.4+).
 */

const FLAG = "rosh-shaket:push-endpoint";

export type PushAvailability = "ok" | "unsupported" | "ios-needs-install" | "denied";

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function appleMobile(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function pushAvailability(): PushAvailability {
  if (typeof window === "undefined") return "unsupported";
  if (appleMobile() && !isStandalone()) return "ios-needs-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  return "ok";
}

/** True when this device receives reminders by push (so the in-app timer stays quiet). */
export function pushEnabledHere(): boolean {
  try {
    return Boolean(localStorage.getItem(FLAG));
  } catch {
    return false;
  }
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function call(path: string, token: string, init: RequestInit = {}) {
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` } });
  const data = (await res.json().catch(() => ({}))) as { error?: string; sent?: number };
  if (!res.ok) throw new Error(data.error ?? `http_${res.status}`);
  return data;
}

export async function enablePush(token: string): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("permission");
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
  await navigator.serviceWorker.ready;
  const keyRes = await fetch("/api/push/key");
  const { publicKey } = (await keyRes.json()) as { publicKey: string };
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
  await call("/api/push/subscribe", token, { method: "POST", body: JSON.stringify(sub.toJSON()) });
  localStorage.setItem(FLAG, sub.endpoint);
}

export async function disablePush(token: string | null): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    if (token) await call("/api/push/subscribe", token, { method: "DELETE", body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => undefined);
    await sub.unsubscribe().catch(() => undefined);
  }
  try {
    localStorage.removeItem(FLAG);
  } catch {}
}

export async function testPush(token: string): Promise<number> {
  const r = await call("/api/push/test", token, { method: "POST" });
  return r.sent ?? 0;
}
