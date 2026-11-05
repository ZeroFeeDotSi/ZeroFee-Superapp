// A component whose code loads when it is first drawn, never in Home's first load (speed budget, headroom 3 Nov). Kept once
// here, so it draws at once every time after; until then it draws nothing (the parts that use it aren't Home's first
// paint: Settings, the account's rows, its places, a hold's line). A failed load is asked again on the next draw.
import { createElement, useEffect, useState, type ComponentType } from "react";
import { reloadForChunk } from "@zerofee/shell-api/chunk-reload.ts";

export function later<P extends object>(load: () => Promise<ComponentType<P>>): ComponentType<P> & { preload: () => Promise<unknown> } {
  let here: ComponentType<P> | null = null;
  let asked: Promise<ComponentType<P>> | null = null;
  const get = () => (asked ??= load().then((c) => (here = c), (e: unknown) => { asked = null; reloadForChunk(e); throw e; }));
  function Later(props: P) {
    const [c, setC] = useState<ComponentType<P> | null>(() => here);
    useEffect(() => {
      let live = true;
      if (!c) void get().then((x) => live && setC(() => x), () => undefined);
      return () => { live = false; };
    }, []);
    return c ? createElement(c, props) : null;
  }
  return Object.assign(Later, { preload: () => get() });
}
