// A swap in place's job ending, for the screens that show its money (real-tap proof, 6 Nov, 4c: a job picked up after a reload
// ended with Hot and an open Activity still on their old read, as nothing else tells them). Small: Home's first load reads it.

/** A swap in place's job row, Home's own (InplaceSwap.tsx: "swap:" and swap-corridor.ts swapKey's "home-swap-"). No other
 *  "swap:" row is: Trade's are its own app's and a coin trade's (CoinSwap.tsx) is by its quote's id. */
export const isHomeSwapRow = (id: string): boolean => id.startsWith("swap:home-swap-");

type Listed = { list(): readonly { id: string; app: string; state: string }[]; subscribe(fn: () => void): () => void };

/** `onEnd` once each time a swap in place's job leaves pending, however it was followed: this page's tap, or a reload's pick-up. */
export function watchSwapEnds(store: Listed, onEnd: () => void): () => void {
  const going = () => new Set(store.list().filter((t) => t.app === "home" && t.state === "pending" && isHomeSwapRow(t.id)).map((t) => t.id));
  let was = going();
  return store.subscribe(() => {
    const now = going();
    const ended = [...was].some((id) => !now.has(id));
    was = now;
    if (ended) onEnd();
  });
}
