// A tiny stand-in for React's hooks, for tests that must see effects run (renderToString never runs them): a test's
// vite server maps "react" here, mounts a tree with `mount`, and counts how many times it renders while it settles.
// It follows React's rules for what matters to a render loop: an effect runs after a render when a dep changed by
// Object.is, a memo is kept while its deps hold, and setState with a new value renders again. Nothing is drawn.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Hook = { value?: any; deps?: readonly unknown[]; cleanup?: (() => void) | void; ref?: { current: any } };
type Fiber = { hooks: Hook[]; seen: boolean };
type Effect = () => void;

const FRAGMENT = Symbol.for("react.fragment");
const CONTEXT = Symbol.for("react.context");
const MEMO = Symbol.for("react.memo");
const FORWARD = Symbol.for("react.forward_ref");

export const Fragment = FRAGMENT;
export const StrictMode = FRAGMENT;
export const Suspense = FRAGMENT;

let fibers = new Map<string, Fiber>();
let fiber: Fiber | null = null;
let slot = 0;
let effects: Effect[] = [];
let dirty = false;
let root: unknown = null;
const contexts = new Map<object, unknown[]>();
export let renders = 0;

const same = (a?: readonly unknown[], b?: readonly unknown[]) => !!a && !!b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
const hook = (): Hook => {
  if (!fiber) throw new Error("a hook outside a component");
  return (fiber.hooks[slot++] ??= {});
};

export function useState<T>(initial: T | (() => T)): [T, (next: T | ((was: T) => T)) => void] {
  const h = hook();
  if (!("value" in h)) {
    h.value = typeof initial === "function" ? (initial as () => T)() : initial;
    const set = (next: T | ((was: T) => T)) => {
      const value = typeof next === "function" ? (next as (was: T) => T)(h.value) : next;
      if (Object.is(value, h.value)) return;
      h.value = value;
      dirty = true;
    };
    h.ref = { current: set };
  }
  return [h.value, h.ref!.current];
}
export function useReducer<S, A>(reduce: (s: S, a: A) => S, initial: S): [S, (a: A) => void] {
  const [s, set] = useState(initial);
  return [s, (a: A) => set((was) => reduce(was, a))];
}
export function useRef<T>(initial: T): { current: T } {
  const h = hook();
  return (h.ref ??= { current: initial });
}
export function useMemo<T>(make: () => T, deps: readonly unknown[]): T {
  const h = hook();
  if (!same(h.deps, deps)) {
    h.value = make();
    h.deps = deps;
  }
  return h.value;
}
export const useCallback = <T,>(fn: T, deps: readonly unknown[]): T => useMemo(() => fn, deps);
export function useEffect(run: () => (() => void) | void, deps?: readonly unknown[]): void {
  const h = hook();
  if (deps && same(h.deps, deps)) return;
  h.deps = deps;
  effects.push(() => {
    if (typeof h.cleanup === "function") h.cleanup();
    h.cleanup = run();
  });
}
export const useLayoutEffect = useEffect;
export const useInsertionEffect = useEffect;
export function useId(): string {
  return useMemo(() => `id${Math.random().toString(36).slice(2)}`, []);
}
export function useSyncExternalStore<T>(subscribe: (cb: () => void) => () => void, get: () => T): T {
  const [, bump] = useState(0);
  useEffect(() => subscribe(() => bump((n) => n + 1)), [subscribe]);
  return get();
}
export function createContext<T>(value: T) {
  const ctx: any = { $$typeof: CONTEXT, _currentValue: value };
  ctx.Provider = ctx;
  ctx.Consumer = { $$typeof: CONTEXT, _context: ctx };
  return ctx;
}
export function useContext<T>(ctx: { _currentValue: T }): T {
  const stack = contexts.get(ctx);
  return stack?.length ? (stack[stack.length - 1] as T) : ctx._currentValue;
}
export const memo = (type: unknown) => ({ $$typeof: MEMO, type });
export const forwardRef = (render: unknown) => ({ $$typeof: FORWARD, render });
export const lazy = () => () => null;
/** Class components (the shell's AppBoundary): drawn once from their initial state; no boundary behaviour is faked. */
export class Component<P = unknown, S = unknown> {
  props: P;
  state = {} as S;
  constructor(props: P) { this.props = props; }
  setState(): void {}
}
export const startTransition = (run: () => void) => run();

let words: string[] = [];
let classes: string[] = [];
/** The props each component (by name) was last drawn with: a test calls a handler no tap can reach (a drag's drop). */
const drawn = new Map<string, Record<string, unknown>>();
export const propsOf = (name: string): Record<string, unknown> | undefined => drawn.get(name);
/** Is `name` one of the classes on a drawn element (the last render)? */
export const hasClass = (name: string): boolean => classes.some((c) => c.split(/\s+/).includes(name));
let taps: { label: string; props: { onClick: (e: unknown) => void; disabled?: boolean } }[] = [];
/** Taps the first drawn element with a click handler whose text matches (as a person taps a button by its words). */
export function press(label: RegExp): void {
  const hit = taps.find((t) => label.test(t.label));
  if (!hit) throw new Error(`nothing to tap matches ${label}: ${taps.map((t) => t.label).join(" | ")}`);
  if (hit.props.disabled) throw new Error(`"${hit.label}" is off`);
  hit.props.onClick({ preventDefault() {}, stopPropagation() {} });
}
/** Taps the first drawn element with a click handler whose aria-label matches (a glyph button with no words: a ✕). */
export function pressNamed(name: RegExp): void {
  const hit = taps.find((t) => name.test(String((t.props as { "aria-label"?: string })["aria-label"] ?? "")));
  if (!hit) throw new Error(`nothing to tap is named ${name}`);
  hit.props.onClick({ preventDefault() {}, stopPropagation() {} });
}
/** The text the last render drew, in order, one piece per line (what a person would read; nothing is laid out). */
export const text = (): string => words.join("\n");

function walk(el: unknown, path: string): void {
  if (typeof el === "string" || typeof el === "number") return void words.push(String(el));
  if (Array.isArray(el)) return el.forEach((k, i) => walk(k, `${path}.${(k as any)?.key ?? i}`));
  if (!el || typeof el !== "object" || !("type" in el)) return;
  const { type, props } = el as { type: any; props: any };
  if (typeof type === "function" && type.prototype instanceof Component) return walk(Object.assign(new (type as any)(props), { props }).render(), path);
  if (typeof type === "function" && !drawn.has(type.name)) drawn.set(type.name, props);
  if (typeof type === "function") return walk(call(type, props, `${path}/${type.name}`), `${path}/${type.name}`);
  if (type && type.$$typeof === MEMO) return walk({ type: type.type, props }, path);
  if (type && type.$$typeof === FORWARD) return walk(call((p: unknown) => type.render(p, null), props, `${path}/fwd`), `${path}/fwd`);
  if (type && type.$$typeof === CONTEXT) {
    const stack = contexts.get(type) ?? [];
    contexts.set(type, stack);
    stack.push(props.value);
    walk(props.children, path);
    stack.pop();
    return;
  }
  if (typeof type === "string" && typeof props?.className === "string") classes.push(props.className);
  const at = words.length;
  walk(props?.children, path);
  if (typeof type === "string" && typeof props?.onClick === "function") taps.push({ label: words.slice(at).join(" "), props });
}

function call(type: (p: unknown) => unknown, props: unknown, key: string): unknown {
  const was = fiber;
  const at = slot;
  fiber = fibers.get(key) ?? { hooks: [], seen: false };
  fibers.set(key, fiber);
  fiber.seen = true;
  slot = 0;
  try {
    return type(props);
  } finally {
    fiber = was;
    slot = at;
  }
}

function render(): void {
  renders++;
  dirty = false;
  for (const f of fibers.values()) f.seen = false;
  words = [];
  classes = [];
  drawn.clear();
  taps = [];
  walk(root, "");
  for (const [k, f] of fibers) {
    if (f.seen) continue;
    for (const h of f.hooks) if (typeof h.cleanup === "function") h.cleanup();
    fibers.delete(k);
  }
  const run = effects;
  effects = [];
  for (const e of run) e();
}

/**
 * Mounts `el`, then lets it settle: renders again whenever state changed, and waits a turn of the event loop between
 * (so a promise that sets state lands). Stops when nothing changes for `quietTurns` turns, or after `limit` renders.
 * Returns how many times it rendered: a tree that never settles comes back at `limit`.
 */
export async function mount(el: unknown, o: { limit?: number; quietTurns?: number } = {}): Promise<number> {
  fibers = new Map();
  effects = [];
  renders = 0;
  root = el;
  render();
  return settle({ ...o, limit: (o.limit ?? 200) - 1 });
}

/** After a tap or a call from outside (a handler the test ran): render until quiet again, as `mount` does. */
export async function settle({ limit = 200, quietTurns = 5 } = {}): Promise<number> {
  const from = renders;
  for (let quiet = 0; quiet < quietTurns && renders - from < limit; ) {
    await new Promise((r) => setTimeout(r, 0));
    if (dirty) {
      quiet = 0;
      render();
    } else quiet++;
  }
  return renders;
}

/** Unmounts what `mount` left: every effect's cleanup runs. */
export function unmount(): void {
  for (const f of fibers.values()) for (const h of f.hooks) if (typeof h.cleanup === "function") h.cleanup();
  fibers = new Map();
  root = null;
}
