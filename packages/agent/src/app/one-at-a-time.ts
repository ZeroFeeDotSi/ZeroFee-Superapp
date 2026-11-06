// One click is one action (hunt 013/014, 6 Nov): a second click before the screen redraws does nothing while the first
// is still going. Each gate is held on its own: the Stops never share one with Start, Pay or Continue, so a hung Start
// can't swallow a kill switch (audit, 6 Nov).
export const oneAtATime = (gate: { current: boolean }) => <A extends unknown[]>(f: (...a: A) => Promise<void>) => (...a: A): Promise<void> => {
  if (gate.current) return Promise.resolve();
  gate.current = true;
  return f(...a).finally(() => void (gate.current = false));
};
