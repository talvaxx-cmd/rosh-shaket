"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { applyOp, emptyState, newId, undoOp, type Op, type UndoResult } from "../domain/store-core";
import type { AppState, Preferences } from "../domain/types";
import { defaultTimeZone } from "../time";

/**
 * Local-first store. Everything lives on this device (localStorage) — no account,
 * no server copy. Swappable later for a synced backend behind the same API.
 */

const KEY = "rosh-shaket:v1";

type Listener = () => void;

/** Told about every local change, so sync can send it. Remote changes don't trigger it. */
export type ChangeHook = (itemIds: string[], prefsChanged: boolean) => void;

/** Preferences that belong to this device only and are never synced. */
const DEVICE_PREFS = ["onboarded", "saveDraftsLocally"] as const;

export class LocalStore {
  private state: AppState;
  private listeners = new Set<Listener>();
  private changeHook: ChangeHook | null = null;
  readonly persistent: boolean;

  setChangeHook(hook: ChangeHook | null) {
    this.changeHook = hook;
  }

  constructor() {
    const { state, persistent } = this.load();
    this.state = state;
    this.persistent = persistent;
  }

  private load(): { state: AppState; persistent: boolean } {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as AppState;
        if (parsed?.version === 1) return { state: { ...emptyState(), ...parsed, prefs: { ...emptyState().prefs, ...parsed.prefs } }, persistent: true };
      }
      window.localStorage.setItem("rosh-shaket:probe", "1");
      window.localStorage.removeItem("rosh-shaket:probe");
      return { state: emptyState({ timeZone: defaultTimeZone() }), persistent: true };
    } catch {
      return { state: emptyState({ timeZone: defaultTimeZone() }), persistent: false };
    }
  }

  get = () => this.state;

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private commit(next: AppState) {
    this.state = next;
    this.save();
    for (const l of this.listeners) l();
  }

  /** Throws when persisting fails, so the UI can say "not saved" and offer a retry. */
  private save() {
    if (!this.persistent) return;
    window.localStorage.setItem(KEY, JSON.stringify(this.state));
  }

  dispatch(op: Op): boolean {
    const prev = this.state;
    const res = applyOp(prev, op);
    if (!res.applied) return false;
    try {
      this.commit(res.state);
    } catch (e) {
      // Roll back in memory so the UI never shows something that isn't stored.
      this.state = prev;
      for (const l of this.listeners) l();
      throw e;
    }
    this.changeHook?.([...(op.remove ?? []), ...(op.put ?? []).map((i) => i.id)], false);
    return true;
  }

  undo(opId: string): UndoResult {
    const entry = this.state.history.find((h) => h.opId === opId);
    const res = undoOp(this.state, opId, `undo:${opId}`);
    if (res.ok) {
      this.commit(res.state);
      if (entry) this.changeHook?.(Object.keys(entry.before), false);
    }
    return res;
  }

  setPrefs(patch: Partial<Preferences>) {
    this.commit({ ...this.state, prefs: { ...this.state.prefs, ...patch } });
    const shared = Object.keys(patch).some((k) => !(DEVICE_PREFS as readonly string[]).includes(k));
    if (shared) this.changeHook?.([], true);
  }

  replaceAll(next: AppState) {
    const ids = new Set([...Object.keys(this.state.items), ...Object.keys(next.items)]);
    this.commit(next);
    this.changeHook?.([...ids], true);
  }

  /** Synced preferences without device-only ones. */
  sharedPrefs(): Record<string, unknown> {
    const p: Record<string, unknown> = { ...this.state.prefs };
    for (const k of DEVICE_PREFS) delete p[k];
    return p;
  }

  /** Applies changes that came from another device. Not recorded in local history, not echoed back. */
  applyRemote(changes: { id: string; data: unknown | null }[], prefs: Record<string, unknown> | null) {
    if (!changes.length && !prefs) return;
    const items = { ...this.state.items };
    for (const c of changes) {
      if (c.data === null) delete items[c.id];
      else items[c.id] = c.data as AppState["items"][string];
    }
    let nextPrefs = this.state.prefs;
    if (prefs) {
      const local = Object.fromEntries(DEVICE_PREFS.map((k) => [k, this.state.prefs[k]]));
      nextPrefs = { ...this.state.prefs, ...(prefs as Partial<Preferences>), ...local };
    }
    this.commit({ ...this.state, items, prefs: nextPrefs });
  }

  /** Another tab changed the data. */
  reloadFromStorage() {
    const { state } = this.load();
    this.state = state;
    for (const l of this.listeners) l();
  }
}

interface Toast {
  id: string;
  text: string;
  undoOpId?: string;
  tone?: "ok" | "error";
}

interface StoreApi {
  store: LocalStore;
  toasts: Toast[];
  toast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;
}

const Ctx = createContext<StoreApi | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<LocalStore | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const s = new LocalStore();
    setStore(s);
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) s.reloadFromStorage();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const toast = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = newId("toast");
      setToasts((ts) => [...ts.slice(-2), { ...t, id }]);
      timers.current.set(id, setTimeout(() => dismissToast(id), t.undoOpId ? 8000 : 4000));
    },
    [dismissToast],
  );

  const api = useMemo(() => (store ? { store, toasts, toast, dismissToast } : null), [store, toasts, toast, dismissToast]);

  if (!api) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-muted" aria-busy="true">
        טוען…
      </div>
    );
  }
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

function useApi(): StoreApi {
  const api = useContext(Ctx);
  if (!api) throw new Error("StoreProvider missing");
  return api;
}

export function useAppState(): AppState {
  const { store } = useApi();
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export function useActions() {
  const { store, toast } = useApi();
  return useMemo(
    () => ({
      /** Applies an op. Returns false for a duplicate (already saved). Throws on storage failure. */
      dispatch: (op: Op) => store.dispatch(op),
      /** Applies and shows a toast with an undo button. */
      run: (op: Op, message?: string) => {
        try {
          const applied = store.dispatch(op);
          if (applied) toast({ text: message ?? op.label, undoOpId: op.opId });
          return applied;
        } catch {
          toast({ text: "השינוי לא נשמר — אין מקום או שהאחסון חסום. נסו שוב.", tone: "error" });
          return false;
        }
      },
      undo: (opId: string) => {
        const res = store.undo(opId);
        if (res.ok) toast({ text: "בוטל" });
        else if (res.reason === "changed_since") toast({ text: "אי אפשר לבטל: הפריט השתנה מאז. אפשר לערוך אותו ידנית.", tone: "error" });
        else if (res.reason === "already_undone") toast({ text: "הפעולה כבר בוטלה" });
        return res;
      },
      setPrefs: (p: Partial<Preferences>) => store.setPrefs(p),
      replaceAll: (s: AppState) => store.replaceAll(s),
      toast,
      persistent: store.persistent,
    }),
    [store, toast],
  );
}

export function useToasts() {
  const { toasts, dismissToast } = useApi();
  return { toasts, dismissToast };
}

/** Current time, refreshed every 30 seconds. */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** The store itself, for services (sync) that hook into every change. */
export function useStoreInstance(): LocalStore {
  return useApi().store;
}
