// ?demo, 2 Nov: opening Trade logged "useShell() is only available inside an app the shell is rendering". Its neighbour
// ZeroFee Chat was mounted from a second copy of the shell's context module (another checkout's packages, reached through
// node_modules), so it read that copy's default, whose every call throws, inside the shell's own Provider.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createContext, createElement, useContext } from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("two copies of the shell's context module are one context: an app from either reads the shell's Provider", async () => {
  const a = (await import("./shell-context.ts")).ShellContext;
  const b = (await import("./shell-context.ts?second-copy")).ShellContext;
  // the control: two copies of a module are two instances, and createContext in each makes two contexts
  const c1 = (await import("./shell-context.ts?control-1")) as object;
  assert.notEqual(c1, await import("./shell-context.ts?control-2"), "each query string is its own module instance");
  assert.notEqual(createContext(0), createContext(0), "two createContext calls are two contexts");
  assert.equal(a, b, "one context for the page");
  // an app reading the second copy, rendered inside the shell's Provider from the first, gets the shell's value
  const App = () => String(useContext(b).count);
  assert.equal(renderToStaticMarkup(createElement(a.Provider, { value: { ...(null as never), count: 5 } as never }, createElement(App))), "5");
});
