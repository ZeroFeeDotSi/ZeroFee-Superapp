// The Sign-up Robot's shapes (D29), to Security's rules (backlog/security.md, section D, binding). A partner's sign-up
// opens in robot mode; the host's robot.js summarises the page (never a value) and does what the robot asks; Claude, on
// the person's own key, picks each step in OUR page; ZeroFee's code checks every step before the host checks it again
// natively. Secrets and the person's details only ever travel as placeholders the host fills from its Keychain.

/**
 * What the robot needs of a partner's recipe: the part of Pay's `Recipe` (packages/pay/src/partners/recipes.ts, Security's
 * schema A) it reads, so Pay's RECIPES pass straight in. Compiled into the app; every change reviewed by Security.
 */
export interface Recipe {
  /** e.g. "Mt Pelerin", for the screens. */
  name: string;
  /** Where it starts: an https page on one of `hosts`. */
  start: string;
  /** The partner's exact hosts. No wildcards: a subdomain that isn't listed isn't the partner's. */
  hosts: readonly string[];
  /** The profile slots it may fill. */
  profile: readonly ProfileField[];
  /** The login it may fill or create, on exactly this host; null when the partner has no password. */
  login: { host: string } | null;
  /** The words of its commit buttons (pay, confirm an order, delete): always the person's tap (D.D5). */
  commit: readonly string[];
  /** What the person ends up with: the model's goal. */
  gives?: string;
  /** Pay's step guide: what to expect on each screen, in the robot's own action words. */
  steps?: readonly { say: string; act: string; at?: string; fill?: readonly string[]; turn?: string }[];
  /** A heading or text that shows it's finished. Without one, the model's done ends the run (ending is the safe way). */
  done?: { textIncludes: string };
  /** Words that mean the person's turn on this partner, besides the ones every recipe has. */
  pauses?: readonly string[];
}

export type ProfileField = "name" | "email" | "phone" | "address" | "dateOfBirth";
export type Slot = `profile.${ProfileField}` | "login.username" | "login.password" | "login.new";

/** One thing on the page, as robot.js reports it (D.D2). Ids mean something only in this snapshot. Never a value. */
export interface PageElement {
  id: string;
  kind: "field" | "button" | "link" | "heading" | "text";
  /** A field's tag: "input", "select" or "textarea". */
  tag?: string;
  /** A field's type: "email", "password", "checkbox", "file", "tel", … */
  type?: string;
  /** A field's autocomplete: "email", "given-name", "one-time-code", "cc-number", "new-password", … */
  autocomplete?: string;
  /** A field's label or name text. */
  label?: string;
  /** A button's, heading's or help text's own words; a link's text. */
  text?: string;
  /** A link's target host, and nothing else of it. */
  host?: string;
  /** A select's options, by their text. */
  options?: string[];
  required?: boolean;
  invalid?: boolean;
  /** Filled or empty: what's in it never comes back. */
  filled?: boolean;
  checked?: boolean;
  /** A text that is the page's own error message (robot.js: visible error text near a field). */
  error?: boolean;
  /** The id of the field a help or error text sits next to. */
  near?: string;
}

/** `partner.snapshot {}`: the main frame's visible page, at most 8 KB. The host is added natively, not by the page. */
export interface Snapshot {
  host: string;
  /** The page's own language (document.documentElement.lang): the robot's words are English, so only en* pages run. */
  lang?: string;
  elements: PageElement[];
  /** robot.js cut the page short (8 KB): there is more below, so scrolling may show it. */
  more?: boolean;
}

/** The fixed action schema (D.D4). Checked here against the latest snapshot, then natively by the host. */
export type RobotAction =
  | { kind: "fill"; id: string; value: string }
  | { kind: "select"; id: string; option: string }
  | { kind: "check"; id: string }
  | { kind: "click"; id: string }
  | { kind: "scroll"; id: string }
  | { kind: "wait"; ms: number }
  | { kind: "yourTurn"; reason: string }
  | { kind: "done"; summary: string };

/** What `partner.act` carries: the actions the host performs. */
export type HostAction = Extract<RobotAction, { kind: "fill" | "select" | "check" | "click" | "scroll" | "wait" }>;

/** `partner.event`: what the host tells the robot as it happens. */
export type PartnerEvent = { kind: "navigated"; host: string } | { kind: "paused" } | { kind: "ended"; why: string };

/** The host's robot mode, as the loop sees it. `hostFromBridge` makes one from `partner.*`. */
export interface RobotHost {
  snapshot(): Promise<Snapshot>;
  act(action: HostAction): Promise<{ ok: true } | { ok: false; why: string }>;
  /** "Your turn": the person does this step; resolves when they tap Continue, or Stop. */
  yourTurn(why: string): Promise<"continue" | "stop">;
  /** The run is finished: the host ends robot mode (removes robot.js, drops the run's Face ID). */
  done(): Promise<void>;
  /** Events as they happen. Returns an unsubscribe function. */
  onEvent(handler: (e: PartnerEvent) => void): () => void;
}

/** What the model sees for one step: the goal, the slots it may use (names only), the page, and what came before. */
export interface ThinkInput {
  partner: string;
  goal: string;
  /** Pay's step guide, one line a step. */
  guide: string[];
  slots: Slot[];
  page: Snapshot;
  history: string[];
  /** AgentZero's browser (D114): the person's own words for the task (then `partner` is the page's host, no slots). */
  task?: string;
  /** The page's visible words, capped by the host (D114). */
  pageText?: string;
  /** A small JPEG of the page (base64), only when its words are thin and no secret box is on screen (D114). */
  picture?: string;
}
