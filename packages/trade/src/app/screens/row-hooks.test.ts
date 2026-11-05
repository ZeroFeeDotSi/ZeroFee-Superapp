// The 5 Nov walk (design review): Trenches' Row returned null for a coin whose logo failed BEFORE the quiet Buy chip's hooks,
// so a logo going "none" on Hot or New rendered fewer hooks than the last render and React took Trade down ("Trade
// crashed: Rendered fewer hooks than expected"). Every hook of a list row comes before its first early return.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/** The hook calls after a component's first `return null;` (a hook there runs on some renders and not others). */
export function hooksAfterEarlyReturn(body: string): string[] {
  const at = body.indexOf("return null;");
  if (at < 0) return [];
  return [...body.slice(at).matchAll(/\buse[A-Z]\w*\(/g)].map((m) => m[0]);
}

const rowBody = (src: string): string => {
  const start = src.indexOf("const Row = memo(function Row(");
  assert.ok(start >= 0, "Discover's Row is where it was");
  const end = src.indexOf("\n});", start);
  return src.slice(start, end);
};

test("Trenches' Row: no hook after its early return (a failed logo never crashes Trade)", () => {
  const src = readFileSync(new URL("./Discover.tsx", import.meta.url), "utf8");
  assert.deepEqual(hooksAfterEarlyReturn(rowBody(src)), []);
});

test("control: the check finds a hook after an early return (the 5 Nov shape)", () => {
  const bad = `const a = useLogo(x);\n  if (gone) return null;\n  const [buy] = useState(null);\n  useEffect(() => {}, []);`;
  assert.deepEqual(hooksAfterEarlyReturn(bad), ["useState(", "useEffect("]);
});
