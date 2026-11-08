// Every user-visible string in the app, found in the source: the words people read on the web screens, the core's
// sheets and Problems, and the iPhone's own Swift screens. Used by the voice guard (voice.test.ts) and the copy audit
// (node tools/copy/audit.ts > $ZEROFEE_HOME/COPY-AUDIT.md). The house style is the house style.
//
// It reads, from TypeScript: JSX text, the visible attributes (aria-label, title, placeholder, alt, label), and any
// other string that reads like a sentence or a label (two words or more with a capital, or a known label key). Code is
// left out: imports, class names, ids, method names, comparisons, keys, console and Error messages.
import ts from "typescript";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface Found { file: string; line: number; text: string; kind: "jsx" | "attr" | "string" | "swift" }

export const ROOT = new URL("../../", import.meta.url).pathname;

/** Where people's words live. Tests, test helpers, robots and fakes are not shown to anyone. */
const DIRS = ["apps/web/src", "apps/ios/ZeroFee", ...readdirSync(join(ROOT, "packages")).map((p) => `packages/${p}/src`)];
const SKIP = /(recorded-data|chat\/src\/places|\.test\.ts$|\/testing\/|\/sim\/agent-(fixtures|injections|suite)\.ts$|\/robot\/|\/fake-|\.d\.ts$|DebugProbe|PartnerScripts|PartnerRobot|\/vectors?\b|\/evm\/abi|\/known-chains|\/sol\/jup-programs)/;

export function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    let names: string[];
    try {
      names = readdirSync(join(ROOT, d));
    } catch {
      return;
    }
    for (const n of names) {
      const p = `${d}/${n}`;
      if (n === "node_modules") continue;
      if (statSync(join(ROOT, p)).isDirectory()) walk(p);
      else if (/\.(tsx?|swift)$/.test(n) && !SKIP.test(p)) out.push(p);
    }
  };
  DIRS.forEach(walk);
  return out.sort();
}

const VISIBLE_ATTRS = new Set(["aria-label", "title", "placeholder", "alt", "label", "aria-description", "aria-valuetext"]);
const LABEL_KEYS = new Set(["label", "title", "whatHappened", "more", "where", "sub", "note", "body", "hint", "text", "line", "heading", "cta", "button", "done", "lead", "detail", "help", "empty", "action", "name", "say", "lines", "headline", "subtitle", "description", "why", "status", "summary", "warning", "caption", "pill", "tip", "ask", "prompt"]);
/** Reads as words for a person: at least one letter run of 2+, and not a code token. */
function looksLikeWords(s: string, labelled: boolean): boolean {
  const t = s.trim();
  if (t.length < 2 || !/[A-Za-z]{2}/.test(t)) return false;
  if (/^(https?:|wss?:|data:|\/|\.\/|#|@|\$\{)/.test(t) && !/\s/.test(t)) return false;
  if (/^[a-z0-9_.:/-]+$/.test(t) && !(labelled && /^[a-z]+$/.test(t) && t.length > 2)) return false; // ids, keys, classes
  if (/^[\w-]+(\s+[\w-]+)*$/.test(t) && /(^|\s)(zf|pr|tr|pay|ch|ag|br|wl|ea|sc|ob)-/.test(t)) return false; // class lists
  if (/[{};]\s*$|=>|function\s*\(|\bvar\(--|px\b.*\bpx\b|^[A-Z_]{3,}$|^[A-Za-z]+\.[a-z][\w.]+$/.test(t)) return false; // code, css, CONST, a.b.c
  if (/^[A-Z][a-z]+([A-Z][a-z]+)+$/.test(t)) return false; // CamelCase identifiers
  if (labelled) return true;
  // an unlabelled string must read like a phrase: two words, a capital or a sentence mark
  return /[A-Za-z]{2,}[\s ]+[A-Za-z0-9$]/.test(t) && (/^[A-Z$0-9"“(]/.test(t) || /[.?!:,]/.test(t) || /\s/.test(t));
}

function templateText(n: ts.TemplateExpression, src: ts.SourceFile): string {
  let s = n.head.text;
  for (const span of n.templateSpans) s += `{${span.expression.getText(src).slice(0, 40)}}` + span.literal.text;
  return s;
}

/** Calls whose string arguments are code, not words for a person. */
const CODE_CALLS = /^(bridge\.call|call|console\.\w+|require|import|fetch|postMessage|addEventListener|removeEventListener|querySelector(All)?|getElementById|setAttribute|getItem|setItem|removeItem|localStorage\.\w+|sessionStorage\.\w+|new URL|new Error|new TypeError|new RangeError|Error|assert\w*|test|it|describe|startsWith|endsWith|includes|indexOf|split|replace|replaceAll|match|test|RegExp|new RegExp|padStart|padEnd|join|createElement|dispatchEvent|new CustomEvent|new Event|send|emit|on|off|matchMedia|get|has|set|delete|fromCharCode|encode|decode|TextEncoder|TextDecoder|sha256|keccak_256|digest|importKey|deriveBits|deriveKey|sign|verify|navigate|open|track|log|warn|debug|fail|throw\w*)$/;

export function fromTs(file: string, code = readFileSync(join(ROOT, file), "utf8")): Found[] {
  const src = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Found[] = [];
  const add = (node: ts.Node, text: string, kind: Found["kind"]) => {
    const t = text.replace(/\s+/g, " ").trim();
    if (t) out.push({ file, line: src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1, text: t, kind });
  };
  const labelledBy = (node: ts.Node): boolean => {
    let p = node.parent;
    while (p && (ts.isConditionalExpression(p) || ts.isBinaryExpression(p) || ts.isParenthesizedExpression(p) || ts.isArrayLiteralExpression(p) || ts.isAsExpression(p))) p = p.parent;
    if (p && ts.isPropertyAssignment(p) && p.initializer !== node) {
      const k = p.name.getText(src).replace(/["']/g, "");
      return LABEL_KEYS.has(k);
    }
    if (p && ts.isPropertyAssignment(p)) return LABEL_KEYS.has(p.name.getText(src).replace(/["']/g, ""));
    return !!p && (ts.isJsxExpression(p) || ts.isReturnStatement(p) || ts.isArrowFunction(p));
  };
  const isCode = (node: ts.Node): boolean => {
    const p = node.parent;
    if (!p) return false;
    if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p) || ts.isImportTypeNode?.(p as ts.Node) || ts.isLiteralTypeNode(p)) return true;
    if (ts.isPropertyAssignment(p) && p.name === node) return true; // a key
    if (ts.isElementAccessExpression(p) || ts.isCaseClause(p)) return true;
    if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.InKeyword].includes(p.operatorToken.kind)) return true;
    if (ts.isJsxAttribute(p)) return !VISIBLE_ATTRS.has(p.name.getText(src));
    if (ts.isCallExpression(p) || ts.isNewExpression(p)) {
      const callee = p.expression.getText(src);
      const last = callee.split(".").pop() ?? "";
      if (CODE_CALLS.test(callee) || CODE_CALLS.test(last) || /Error$/.test(callee)) return true;
    }
    if (ts.isThrowStatement(p)) return true;
    // a property key "className", "style", "kind", "code", "screen", "id", "method", "type" ...
    if (ts.isPropertyAssignment(p)) {
      const k = p.name.getText(src).replace(/["']/g, "");
      if (/^(className|class|style|kind|code|screen|id|method|type|state|key|field|url|href|src|icon|chain|network|coin|symbol|token|contract|account|role|tone|variant|status|mode|path|route|tab|app|scheme|host|origin|color|bg|font)$/.test(k)) return !LABEL_KEYS.has(k);
    }
    return false;
  };
  // An engine's own reason ("balance 3 does not cover the amount plus gas") starts lower-case and isn't under a label
  // key: it is for the log, not for a person. A "where" fragment ("in your Safe") is under a label key, so it stays.
  const keyOf = (node: ts.Node): string | null => {
    let p = node.parent;
    while (p && (ts.isConditionalExpression(p) || ts.isBinaryExpression(p) || ts.isParenthesizedExpression(p) || ts.isArrayLiteralExpression(p) || ts.isAsExpression(p))) p = p.parent;
    return p && ts.isPropertyAssignment(p) ? p.name.getText(src).replace(/["']/g, "") : null;
  };
  const internal = (node: ts.Node, text: string): boolean => {
    const k = keyOf(node);
    if (k && /^(source|sources|evidence|checked|ref|docs|reason|log|debug|internal|dev)$/.test(k)) return true;
    // a lone lower-case word under `where`, `status` or `why` is a code value ({ where: "float" }); a label is read
    if (/^[a-z]+$/.test(text.trim()) && !(k && /^(label|title|name)$/.test(k)) && !ts.isJsxExpression(node.parent)) return true;
    return /^[a-z]/.test(text.trim()) && !(k && LABEL_KEYS.has(k)) && !file.endsWith(".tsx");
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      if (/[A-Za-z]{2}/.test(node.text)) add(node, node.text, "jsx");
    } else if (ts.isJsxAttribute(node) && VISIBLE_ATTRS.has(node.name.getText(src)) && node.initializer && ts.isStringLiteral(node.initializer)) {
      add(node, node.initializer.text, "attr");
      return;
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!isCode(node) && looksLikeWords(node.text, labelledBy(node)) && !internal(node, node.text)) add(node, node.text, "string");
    } else if (ts.isTemplateExpression(node)) {
      const text = templateText(node, src);
      const literal = text.replace(/\{[^}]*\}/g, " ");
      if (!isCode(node) && looksLikeWords(literal, labelledBy(node)) && !internal(node, text) && /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(literal + " " + text)) add(node, text, "string");
      return;
    } else if (ts.isTaggedTemplateExpression(node)) {
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
  return out;
}

/** Swift: string literals that read as words, outside comments, logs, JavaScript snippets and identifiers. */
export function fromSwift(file: string, code = readFileSync(join(ROOT, file), "utf8")): Found[] {
  const out: Found[] = [];
  let inBlock = false;
  let inMulti = false;
  code.split("\n").forEach((raw, i) => {
    let line = raw;
    if (inBlock) {
      if (!line.includes("*/")) return;
      line = line.slice(line.indexOf("*/") + 2);
      inBlock = false;
    }
    if (line.includes('"""')) {
      inMulti = !inMulti;
      return;
    }
    if (inMulti) return; // multi-line literals here are JavaScript or HTML
    if (/^\s*\/\//.test(line)) return;
    if (/\b(print|NSLog|os_log|logger\.\w+|fatalError|precondition|assert\w*|evaluateJavaScript|callAsyncJavaScript|evaluateScript|forKey|forResource|UserDefaults|Notification\.Name|addScriptMessageHandler|name:\s*"zf|withIdentifier|identifier:|systemName:|named:|NSPredicate|DispatchQueue\(label|kSec|accessibilityIdentifier)\b/.test(line)) return;
    line = line.replace(/\/\/.*$/, (m) => (/"[^"]*\/\/[^"]*"/.test(line) ? m : ""));
    if (line.includes("/*")) inBlock = !line.includes("*/");
    const re = /"((?:[^"\\]|\\.)*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      const text = m[1].replace(/\\\(([^)]*)\)/g, "{$1}").replace(/\\n/g, " ").replace(/\\"/g, '"');
      const literal = text.replace(/\{[^}]*\}/g, " ");
      const labelled = /(Text|Button|Label|title:|message:|label:|Section|navigationTitle|alert|localizedReason|prompt:|placeholder|confirmationDialog)\s*\(?\s*"?$/.test(line.slice(0, m.index).trimEnd() + '"') || /(Text|Button|Label)\($/.test(line.slice(0, m.index).trimEnd());
      if (/^[a-z0-9_.:/-]+$/.test(literal.trim()) || /[{};]\s*$|=>|function\s*\(|window\.|document\.|\.zf|zf[A-Z]/.test(literal)) continue;
      if (looksLikeWords(literal, labelled) && (labelled || /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(literal))) out.push({ file, line: i + 1, text: text.trim(), kind: "swift" });
    }
  });
  return out;
}

export function allStrings(): Found[] {
  return sourceFiles().flatMap((f) => (f.endsWith(".swift") ? fromSwift(f) : fromTs(f)));
}

export const rel = (p: string) => relative(ROOT, p);
