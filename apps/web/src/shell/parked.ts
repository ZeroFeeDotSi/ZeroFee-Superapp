// D146: a money sheet put away because the person left its app. It waits in the Activity centre as "Waiting for you";
// a tap there brings its app back with the sheet up again (AppHost's openApp reads the route).
import type { MoneyAsk } from "@zerofee/shell-api/money.ts";
import type { TaskInput } from "@zerofee/shell-api/tasks.ts";

/** The route a parked sheet's task opens: "parked:<seq>". */
export const PARKED = "parked:";
export const PARKED_LINE = "Waiting for you. Nothing moved. Tap to go back to it.";

/** What the sheet was for, in the person's words. */
export function askWords(ask: MoneyAsk): string {
  switch (ask.kind) {
    case "send": return "Send";
    case "receive": return "Add money";
    case "request": return "Ask someone to pay you";
    case "swap": return "Swap";
    case "move": return "Move";
    case "topup": return "Move to your NEAR wallet";
    case "putaway": return "Move to your Safe";
    case "cap": return "Your NEAR wallet's limit";
    case "siteadd": return `Put money in ${ask.name}`;
    case "siteback": return `Move from ${ask.name} to your Safe`;
  }
}

export const parkedTask = (id: string, ask: MoneyAsk): TaskInput => ({ id, title: askWords(ask), steps: [], detail: PARKED_LINE, open: { route: id } });
