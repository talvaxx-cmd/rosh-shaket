/** Next.js startup hook: start the reminder push scheduler in the Node server. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startPushScheduler } = await import("./lib/server/push-scheduler");
    startPushScheduler();
  }
}
