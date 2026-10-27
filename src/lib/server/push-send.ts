import webpush from "web-push";
import type { Sender, Vapid } from "./push";

export function generateVapid() {
  return webpush.generateVAPIDKeys();
}

export function makeSender(v: Vapid): Sender {
  return async (sub, payload) => {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload), {
        vapidDetails: { subject: v.subject, publicKey: v.publicKey, privateKey: v.privateKey },
        TTL: 60 * 60,
        urgency: "high",
      });
      return "ok";
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return "gone";
      console.warn(`[push] send failed: ${status ?? "network"}`);
      return "error";
    }
  };
}
