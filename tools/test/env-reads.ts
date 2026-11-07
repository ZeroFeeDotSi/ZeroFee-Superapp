// Build flags are read as `import.meta.env.VITE_X` (or `import.meta.env?.VITE_X`, which also runs under node, where
// import.meta.env is undefined): the form Vite writes as a literal, so a build without the flag drops the code behind it
// (the audit's finding, 7 Nov). A read through a cast, `(import.meta as { env?: … }).env?.VITE_X`, a bracket, or the whole env
// object is a form the bundler isn't bound to fold: the code it guards can ship, switched off, in every bundle, and the
// whole object puts every VITE_* value of the build in the bundle. Pure, so its cases are a table test (env-reads.test.ts).

export type LooseRead = { line: number; text: string; why: "cast" | "bracket" | "whole" | "optional-meta" };

/** The source with its comments blanked (their newlines kept, so line numbers hold). A `//` after a `:` (a URL in a
 *  string) is not a comment. */
export const codeOnly = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " ")).replace(/(^|[^:\\])\/\/[^\n]*/g, (_m, pre: string) => pre);

const RULES: Array<[LooseRead["why"], RegExp]> = [
  ["cast", /\(\s*import\.meta\s+as\b/],
  ["bracket", /import\.meta(?:\?\.|\.)env\s*(?:\?\.)?\s*\[|import\.meta\s*\[/],
  ["optional-meta", /import\.meta\?\./],
  // the env object itself: anything after `import.meta.env` that isn't `.NAME` or `?.NAME`
  ["whole", /import\.meta\.env(?!\s*(?:\?\.|\.)\s*[A-Za-z_$])/],
];

/** Each line of `src` with an env read Vite isn't bound to fold. */
export function looseEnvReads(src: string): LooseRead[] {
  const out: LooseRead[] = [];
  codeOnly(src).split("\n").forEach((text, i) => {
    const hit = RULES.find(([, re]) => re.test(text)); // one reason per line: the first rule that matches
    if (hit) out.push({ line: i + 1, text: text.trim(), why: hit[0] });
  });
  return out;
}

/** Files that build the app rather than run in it: they write the env (define), they don't read it. */
export const BUILD_FILES = /(^|\/)vite(\.[a-z]+)?\.config\.ts$|^apps\/ios\/core\/build\.mjs$/;
/** The app's code: packages/ and apps/, not tests and not build files. */
export const inScope = (path: string): boolean =>
  /^(packages|apps)\//.test(path) && /\.(ts|tsx|mts|mjs|js|jsx)$/.test(path) && !/\.test\.[a-z]+$/.test(path) && !/(^|\/)node_modules\//.test(path) && !BUILD_FILES.test(path);
