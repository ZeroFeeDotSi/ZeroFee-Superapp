// How much is where (B12): the Safe and the wallets, said at the top of every money sheet. Its own file so the money
// sheets' host reads it without loading the Move sheets' code (Home's first load, speed budget).
import type { SpendingStatus } from "@zerofee/core/spending";
import type { Pot } from "@zerofee/design/MoneySheet.tsx";
import { dollars } from "../format.ts";

export const potsOf = (safeUsd: string | null, status: SpendingStatus | null): Pot[] => [
  { name: "Safe", usd: safeUsd === null ? null : dollars(safeUsd) },
  { name: "Wallets", usd: status && status.loaded && !status.unread ? dollars(status.totalUsd) : null },
];
