// A message from the panel to the background worker. Chrome stops an idle MV3 worker after about 30 s and starts it again
// for the next message, so a stopped worker is normal, not a fault. The one gap: a message sent while Chrome is stopping
// the worker can find no listener ("Receiving end does not exist"). That message was never delivered, so it is sent
// again, a few times, quickly. Anything else (the worker took it and then went away) is never sent twice: it might be a
// signature, so it comes back as `undefined`, which the caller shows as extension.worker.stopped.
const NOT_DELIVERED = /Receiving end does not exist|Could not establish connection/i;
export const WAKE_WAITS_MS = [150, 400, 1_000];

export async function sendWaking<T>(send: () => Promise<T>, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<T | undefined> {
  for (let i = 0; ; i++) {
    try {
      return await send();
    } catch (e) {
      if (!NOT_DELIVERED.test(String((e as Error)?.message ?? e)) || i >= WAKE_WAITS_MS.length) return undefined;
      await sleep(WAKE_WAITS_MS[i]!);
    }
  }
}
