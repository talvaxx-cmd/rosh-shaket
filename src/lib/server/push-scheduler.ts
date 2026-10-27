import { getPool, syncConfigured } from "./pool";
import { getVapid, pushTick } from "./push";
import { generateVapid, makeSender } from "./push-send";

const EVERY_MS = 30_000;
let started = false;

/** Runs inside the long-lived Node server (Railway): checks for due reminders every 30 seconds. */
export function startPushScheduler() {
  if (started || !syncConfigured()) return;
  started = true;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const pool = getPool();
      const vapid = await getVapid(pool, generateVapid);
      await pushTick(pool, makeSender(vapid));
    } catch {
      console.warn("[push] tick failed");
    } finally {
      busy = false;
    }
  };
  setInterval(tick, EVERY_MS).unref?.();
  setTimeout(tick, 5_000).unref?.();
}
