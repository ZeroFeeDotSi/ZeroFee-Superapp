// Hairline icons, drawn on the same 1.25 px line as the mark.
const P = (d: string, size = 24) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path className="zf-hl" d={d} />
  </svg>
);

export const Back = () => P("M15 5 8 12l7 7", 28);
export const Menu = () => P("M4 9h16M4 15h10", 28);
export const Chevron = () => P("m7 10 5 5 5-5", 16);
export const Close = () => P("M6 6l12 12M18 6 6 18", 20);
export const Check = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <path className="zf-hl" style={{ strokeWidth: 1.6 }} d="m2.5 6.2 2.3 2.3 4.7-5" />
  </svg>
);
export const Face = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden="true">
    <path className="zf-hl" style={size > 40 ? { strokeWidth: 0.5 } : undefined} d="M2 7V4.5A2.5 2.5 0 0 1 4.5 2H7M15 2h2.5A2.5 2.5 0 0 1 20 4.5V7M20 15v2.5a2.5 2.5 0 0 1-2.5 2.5H15M7 20H4.5A2.5 2.5 0 0 1 2 17.5V15M7.5 8v1.5M14.5 8v1.5M11 8v4.5h-1M8 15c1.8 1.4 4.2 1.4 6 0" />
  </svg>
);
export const Copy = () => P("M9 9h10v10H9zM5 15V5h10");
export const TrayOverview = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><circle className="zf-hl" cx="12" cy="12" r="8" /><path className="zf-hl" d="M7.5 16.5 16.5 7.5" /></svg>
);
export const TrayLayers = () => P("m12 4 8 4-8 4-8-4 8-4ZM4 12l8 4 8-4M4 16l8 4 8-4");
export const TrayRecovery = () => P("M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v3h3M12 8.5V12l2.5 1.5");
export const TrayActivity = () => P("M5 7h14M5 12h14M5 17h9");

// The app bar's five (J2): one hairline object each, the same weight as the tray icons.
/** Security: a shield with the mark's stroke through it. */
export const AppSecurity = () => P("M12 3.5 5 6.2v5.3c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6.2L12 3.5ZM9 14.5l6-6");
/** Home (Job 1: Wallet with Security inside it): a house, one hairline. */
export const AppHome = () => P("M4 11.2 12 4.5l8 6.7M6.5 9.4V19.5h11V9.4M10 19.5v-5h4v5");
/** Wallet: the ZeroFee mark (a circle, one stroke through it), where the money is. */
export const AppWallet = TrayOverview;
/** Trade: a line that climbs. */
export const AppTrade = () => P("M3.5 17.5 9 12l3.5 3.5 8-8.5M15.5 7h5v5");
/** Chat: a speech bubble. */
export const AppChat = () => P("M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5h-8l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5Z");
/** Browser: a globe (QA, 3 Nov: it shared the four tiles with AgentZero). */
export const AppBrowser = () => P("M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM3.5 12h17M12 3.5c2.2 2.3 3.4 5.2 3.4 8.5s-1.2 6.2-3.4 8.5M12 3.5C9.8 5.8 8.6 8.7 8.6 12s1.2 6.2 3.4 8.5");
/** Social trading: two people, one a step behind the other (S17 pair: its own glyph, not Trade's). */
export const AppSocial = () => P("M9.5 5.5a3.25 3.25 0 1 0 0 6.5 3.25 3.25 0 0 0 0-6.5ZM3.5 19.5c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M15 5.7a3.25 3.25 0 0 1 0 6.1M17.3 14.3c2 .7 3.2 2.5 3.2 5.2");
/** AgentZero: a four-point spark, its helper's mark. */
export const AppAgent = () => P("M12 3.5c.7 4.6 2.9 6.8 7.5 7.5-4.6.7-6.8 2.9-7.5 7.5-.7-4.6-2.9-6.8-7.5-7.5 4.6-.7 6.8-2.9 7.5-7.5ZM18.5 3.5v3M17 5h3");
// Their filled twins, for the tab on screen (the capsule, product decision, 4 Nov: YouTube's bar fills the tab you're on). Solid in
// the ink; where a line crosses a solid shape (the globe's meridians) it is cut in the pill's colour (--bar-pill).
const solid = { fill: "currentColor", stroke: "currentColor", strokeWidth: 1.25, strokeLinejoin: "round" } as const;
const line = (w: number) => ({ fill: "none", stroke: "currentColor", strokeWidth: w, strokeLinecap: "round", strokeLinejoin: "round" }) as const;
/** Home, filled: the house, its door left open. */
export const AppHomeOn = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path {...solid} d="M12 3.9 3.9 10.7a.7.7 0 0 0 .9 1.07l.7-.58v8.31a1 1 0 0 0 1 1H10v-5.3h4v5.3h3.5a1 1 0 0 0 1-1v-8.31l.7.58a.7.7 0 0 0 .9-1.07Z" /></svg>
);
/** Trade, filled: the climbing line, heavier, its arrowhead solid. */
export const AppTradeOn = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path {...line(2.2)} d="M3.5 17.5 9 12l3.5 3.5 6.6-7" /><path {...solid} d="M15 6.3h5.7V12Z" /></svg>
);
/** Chat, filled: the bubble. */
export const AppChatOn = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path {...solid} d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5h-8l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5Z" /></svg>
);
/** Browser, filled: a solid globe, its lines cut through. */
export const AppBrowserOn = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
    <circle {...solid} cx="12" cy="12" r="8.5" />
    <path fill="none" stroke="var(--bar-pill, #fff)" strokeWidth={1.4} strokeLinecap="round" d="M4.2 12h15.6M12 3.9c2.1 2.3 3.2 5.1 3.2 8.1s-1.1 5.8-3.2 8.1M12 3.9C9.9 6.2 8.8 9 8.8 12s1.1 5.8 3.2 8.1" />
  </svg>
);
/** AgentZero, filled: the spark solid, its small plus heavier. */
export const AppAgentOn = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path {...solid} d="M12 3.5c.7 4.6 2.9 6.8 7.5 7.5-4.6.7-6.8 2.9-7.5 7.5-.7-4.6-2.9-6.8-7.5-7.5 4.6-.7 6.8-2.9 7.5-7.5Z" /><path {...line(1.8)} d="M18.5 3.5v3M17 5h3" /></svg>
);
/** Social trading, filled: the front person solid, the one behind a line. */
export const AppSocialOn = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><circle {...solid} cx="9.5" cy="8.75" r="3.25" /><path {...solid} d="M3.5 19.5c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5Z" /><path {...line(1.8)} d="M15 5.7a3.25 3.25 0 0 1 0 6.1M17.3 14.3c2 .7 3.2 2.5 3.2 5.2" /></svg>
);
/** Apps: four tiles. */
export const AppTiles = () => P("M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z");
/** More apps than the bar holds: three dots in a row. */
export const AppMore = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><circle className="zf-hl" cx="6" cy="12" r="1.3" /><circle className="zf-hl" cx="12" cy="12" r="1.3" /><circle className="zf-hl" cx="18" cy="12" r="1.3" /></svg>
);
