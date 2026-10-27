"use client";

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { useStoreInstance, type LocalStore } from "./store";
import { SyncEngine, type SyncMeta, type SyncStore } from "./sync-engine";

const META_KEY = "rosh-shaket:sync";
const INTERVAL_MS = 30_000;

function loadMeta(): SyncMeta | null {
  try {
    const raw = localStorage.getItem(META_KEY);
    return raw ? (JSON.parse(raw) as SyncMeta) : null;
  } catch {
    return null;
  }
}

function saveMeta(meta: SyncMeta | null) {
  try {
    if (meta) localStorage.setItem(META_KEY, JSON.stringify(meta));
    else localStorage.removeItem(META_KEY);
  } catch {}
}

function adapter(store: LocalStore): SyncStore {
  return {
    getItem: (id) => store.get().items[id],
    allItemIds: () => Object.keys(store.get().items),
    sharedPrefs: () => store.sharedPrefs(),
    applyRemote: (changes, prefs) => store.applyRemote(changes, prefs),
  };
}

/** A readable name for this device in the devices list. */
export function deviceName(): string {
  if (typeof navigator === "undefined") return "מכשיר";
  const ua = navigator.userAgent;
  const kind = /iPhone/.test(ua) ? "אייפון" : /iPad/.test(ua) ? "אייפד" : /Android/.test(ua) ? "אנדרואיד" : /Mac/.test(ua) ? "מק" : /Windows/.test(ua) ? "מחשב Windows" : "מכשיר";
  const app = typeof matchMedia !== "undefined" && matchMedia("(display-mode: standalone)").matches ? " (אפליקציה)" : "";
  return kind + app;
}

async function api<T>(path: string, init: RequestInit = {}, token?: string | null): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `http_${res.status}`);
  return data;
}

export interface DeviceInfo {
  id: string;
  name: string;
  createdAt: string;
  lastSeen: string;
  current: boolean;
}

const Ctx = createContext<SyncEngine | null>(null);

/** Runs sync in the background: on open, after changes, on return to the app, and every 30s while visible. */
export function SyncProvider({ children }: { children: ReactNode }) {
  const store = useStoreInstance();
  const [engine] = useState(() => new SyncEngine(adapter(store), { fetch: (...a) => fetch(...a), load: loadMeta, save: saveMeta }));

  useEffect(() => {
    store.setChangeHook((ids, prefs) => engine.markDirty(ids, prefs));
    const kick = () => {
      if (document.visibilityState === "visible") engine.schedule(0);
    };
    document.addEventListener("visibilitychange", kick);
    window.addEventListener("focus", kick);
    window.addEventListener("online", kick);
    const t = setInterval(kick, INTERVAL_MS);
    engine.schedule(0);
    return () => {
      store.setChangeHook(null);
      document.removeEventListener("visibilitychange", kick);
      window.removeEventListener("focus", kick);
      window.removeEventListener("online", kick);
      clearInterval(t);
    };
  }, [engine, store]);

  return <Ctx.Provider value={engine}>{children}</Ctx.Provider>;
}

export function useSync() {
  const engine = useContext(Ctx);
  if (!engine) throw new Error("SyncProvider missing");
  const snap = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
  return useMemo(
    () => ({
      ...snap,
      syncNow: () => engine.syncNow(),
      /** Turns sync on with this device as the first one. Returns the recovery code (show once). */
      enable: async () => {
        const r = await api<{ token: string; deviceId: string; recoveryCode: string }>("/api/sync/account", {
          method: "POST",
          body: JSON.stringify({ deviceName: deviceName() }),
        });
        await engine.link(r.token, r.deviceId, { uploadLocal: true });
        return r.recoveryCode;
      },
      /** Links this device using a pairing code or the recovery code. Local items are merged in. */
      join: async (code: string) => {
        const r = await api<{ token: string; deviceId: string }>("/api/sync/redeem", {
          method: "POST",
          body: JSON.stringify({ code, deviceName: deviceName() }),
        });
        await engine.link(r.token, r.deviceId, { uploadLocal: true });
      },
      pairingCode: () => api<{ code: string; expiresAt: string }>("/api/sync/pair", { method: "POST" }, engine.token),
      devices: () => api<{ devices: DeviceInfo[] }>("/api/sync/devices", {}, engine.token).then((r) => r.devices),
      removeDevice: async (deviceId: string, isCurrent: boolean) => {
        await api("/api/sync/devices", { method: "DELETE", body: JSON.stringify({ deviceId }) }, engine.token);
        if (isCurrent) engine.unlink();
      },
      unlinkLocal: () => engine.unlink(),
    }),
    [engine, snap],
  );
}
