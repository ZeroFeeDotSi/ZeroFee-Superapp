// The extension's stand-in for apps/web/src/sim-storage.ts (row 35, product decision, 3 Nov: the extension is the real app, never a
// Sim). The extension never runs the Sim, so it never moves storage under Sim's names: nothing here touches storage.
export const SIM_PREFIX = "";
export const LAYOUT_KEY = "zf.web.layout";
export const simKey = (key: string): string => key;
export const simStorage = (base: Storage): Storage => base;
/** The Sim never starts in the extension: false, and nothing is installed. */
export const installSimStorage = (_g?: typeof globalThis): boolean => false;
export const adoptOldDemo = (_base: Storage, _realHere: boolean): "moved" | "kept" | "done" => "done";
