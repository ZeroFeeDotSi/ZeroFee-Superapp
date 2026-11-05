// One writer at a time across every page of this origin (D157 review L2: two ZeroFee side panels, two Chrome windows,
// are two cores on one vault). A read-then-write of a shared record (the one rolling cap's day, subwallets.ts capGate)
// runs under the browser's Web Locks for its name, so two pages can't both read the same day and each add to it (a lost
// write would let twice the cap go with no sheet). Where there are no Web Locks (the phone's isolated core, which is one
// core), it just runs.
type Locks = { request<T>(name: string, cb: () => Promise<T>): Promise<T> };

// The phone's isolated core has no navigator: check it is there before reading it (tools/ios/core-no-url.test.ts).
function webLocks(): Locks | undefined {
  return "navigator" in globalThis ? (globalThis as { navigator?: { locks?: Locks } }).navigator?.locks : undefined;
}

export function originLock<T>(name: string, run: () => Promise<T>, locks: Locks | undefined = webLocks()): Promise<T> {
  return locks ? locks.request(`zerofee:${name}`, run) : run();
}
