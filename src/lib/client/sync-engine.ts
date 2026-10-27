/**
 * Keeps this device's local data in step with the account on the server.
 *
 * Local-first: the app always reads and writes the local store, so it works
 * offline. Every local change marks the item "dirty" with the time it changed;
 * a sync sends dirty items and pulls whatever other devices changed since the
 * last cursor. The server keeps the most recent change per item.
 */

export interface SyncStore {
  getItem(id: string): unknown | undefined;
  allItemIds(): string[];
  sharedPrefs(): Record<string, unknown>;
  applyRemote(changes: { id: string; data: unknown | null }[], prefs: Record<string, unknown> | null): void;
}

export interface SyncMeta {
  token: string;
  deviceId: string;
  cursor: number;
  /** id → when it changed locally (ISO). */
  dirty: Record<string, string>;
  prefsDirtyAt: string | null;
  /** Time of the preferences version this device has. */
  prefsAt: string | null;
  lastSyncAt: string | null;
}

export type SyncStatus = "off" | "idle" | "syncing" | "offline" | "error";

export interface SyncSnapshot {
  linked: boolean;
  status: SyncStatus;
  lastSyncAt: string | null;
  pending: number;
  error: string | null;
}

export interface SyncDeps {
  fetch: typeof fetch;
  load(): SyncMeta | null;
  save(meta: SyncMeta | null): void;
  now?: () => Date;
  /** Called when the server says this device was unlinked. */
  onUnlinked?: () => void;
}

const BATCH = 400;
const DEBOUNCE_MS = 800;

export class SyncEngine {
  private meta: SyncMeta | null;
  private status: SyncStatus;
  private error: string | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private snap: SyncSnapshot;
  private readonly now: () => Date;

  constructor(
    private readonly store: SyncStore,
    private readonly deps: SyncDeps,
  ) {
    this.now = deps.now ?? (() => new Date());
    this.meta = deps.load();
    this.status = this.meta ? "idle" : "off";
    this.snap = this.build();
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  getSnapshot = (): SyncSnapshot => this.snap;

  private build(): SyncSnapshot {
    return {
      linked: this.meta !== null,
      status: this.status,
      lastSyncAt: this.meta?.lastSyncAt ?? null,
      pending: this.meta ? Object.keys(this.meta.dirty).length + (this.meta.prefsDirtyAt ? 1 : 0) : 0,
      error: this.error,
    };
  }

  private emit() {
    this.snap = this.build();
    for (const l of this.listeners) l();
  }

  private persist() {
    this.deps.save(this.meta);
  }

  get token(): string | null {
    return this.meta?.token ?? null;
  }

  /** Local change → remember it and sync soon. */
  markDirty(ids: string[], prefsChanged: boolean) {
    if (!this.meta) return;
    const at = this.now().toISOString();
    for (const id of ids) this.meta.dirty[id] = at;
    if (prefsChanged) this.meta.prefsDirtyAt = at;
    this.persist();
    this.emit();
    this.schedule(DEBOUNCE_MS);
  }

  schedule(ms = 0) {
    if (!this.meta) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.syncNow();
    }, ms);
  }

  /** Joins an account. Everything already on this device is uploaded (merged), nothing is lost. */
  link(token: string, deviceId: string, opts: { uploadLocal: boolean }) {
    const at = this.now().toISOString();
    this.meta = {
      token,
      deviceId,
      cursor: 0,
      dirty: opts.uploadLocal ? Object.fromEntries(this.store.allItemIds().map((id) => [id, at])) : {},
      prefsDirtyAt: opts.uploadLocal ? at : null,
      prefsAt: null,
      lastSyncAt: null,
    };
    this.error = null;
    this.status = "idle";
    this.persist();
    this.emit();
    return this.syncNow();
  }

  /** Stops syncing on this device. Local data stays. */
  unlink() {
    this.meta = null;
    this.status = "off";
    this.error = null;
    if (this.timer) clearTimeout(this.timer);
    this.persist();
    this.emit();
  }

  /** Runs one sync (and repeats while there is more to send or receive). Never throws. */
  syncNow(): Promise<void> {
    if (!this.meta) return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.loop().finally(() => {
      this.running = null;
      if (this.again) {
        this.again = false;
        void this.syncNow();
      }
    });
    return this.running;
  }

  private async loop() {
    for (let round = 0; round < 20 && this.meta; round++) {
      const more = await this.once();
      if (!more) break;
    }
  }

  /** One request. Returns true when another round is needed. */
  private async once(): Promise<boolean> {
    const meta = this.meta!;
    const ids = Object.keys(meta.dirty).slice(0, BATCH);
    const sent = Object.fromEntries(ids.map((id) => [id, meta.dirty[id]!]));
    const changes = ids.map((id) => ({ id, data: this.store.getItem(id) ?? null, at: sent[id]! }));
    const prefsSentAt = meta.prefsDirtyAt;
    const prefs = prefsSentAt ? { data: this.store.sharedPrefs(), at: prefsSentAt } : null;

    this.status = "syncing";
    this.emit();
    let res: Response;
    try {
      res = await this.deps.fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${meta.token}` },
        body: JSON.stringify({ cursor: meta.cursor, changes, prefs }),
      });
    } catch {
      this.status = "offline";
      this.error = null;
      this.emit();
      return false;
    }
    if (res.status === 401) {
      this.unlink();
      this.error = "המכשיר הזה נותק מהסנכרון. הנתונים שעליו נשמרו.";
      this.emit();
      this.deps.onUnlinked?.();
      return false;
    }
    if (!res.ok) {
      this.status = "error";
      this.error = res.status === 503 ? "הסנכרון לא זמין כרגע בשרת." : "הסנכרון נכשל. ננסה שוב בקרוב.";
      this.emit();
      return false;
    }
    const body = (await res.json()) as {
      cursor: number;
      changes: { id: string; data: unknown | null; at: string }[];
      more: boolean;
      prefs: { data: Record<string, unknown>; at: string } | null;
    };
    if (this.meta !== meta) return false; // unlinked meanwhile

    // Sent items are clean unless they changed again while the request was in flight.
    for (const id of ids) if (meta.dirty[id] === sent[id]) delete meta.dirty[id];
    if (prefsSentAt && meta.prefsDirtyAt === prefsSentAt) meta.prefsDirtyAt = null;

    const incoming = body.changes.filter((c) => !(c.id in meta.dirty));
    let prefsIn: Record<string, unknown> | null = null;
    if (body.prefs && !meta.prefsDirtyAt && body.prefs.at !== meta.prefsAt) {
      prefsIn = body.prefs.data;
      meta.prefsAt = body.prefs.at;
    }
    this.store.applyRemote(incoming, prefsIn);

    meta.cursor = body.cursor;
    meta.lastSyncAt = this.now().toISOString();
    this.persist();
    this.status = "idle";
    this.error = null;
    this.emit();
    return body.more || Object.keys(meta.dirty).length > 0 || meta.prefsDirtyAt !== null;
  }
}
