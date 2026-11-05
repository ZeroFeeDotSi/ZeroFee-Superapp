// A read asked of one node, with the next one ready (D134, D10): Solana's and the EVM chains' wallet reads waited for the
// first node's 8 s timeout before they asked the second ("Solana didn't answer"). Now the next node is asked as soon as
// the first fails, or when it hasn't answered in `hedgeMs`; the first good answer is the read. These reads were and stay
// one node's answer (what is signed is checked on its own: the test run, the two-node confirm); only the waiting changed.

/** The first good answer of `nodes`, in order: each next one asked after `hedgeMs`, or at once when one fails. */
export function hedged<T>(nodes: readonly string[], ask: (url: string) => Promise<T>, hedgeMs = 300): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let next = 0;
    let open = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const go = (): void => {
      clearTimeout(timer);
      if (next >= nodes.length) return;
      open++;
      ask(nodes[next++]).then(
        (v) => (clearTimeout(timer), (next = nodes.length), resolve(v)),
        (e) => (--open, next < nodes.length ? go() : open || reject(e)),
      );
      if (next < nodes.length) timer = setTimeout(go, hedgeMs);
    };
    go();
  });
}
