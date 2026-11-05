// Audit L14: the ZeroFee Safe's contract, every release, by its code hash (base58), exactly the list packages/core's
// known-contracts.ts ACCOUNT_POLICY.versions keeps (safe-code.test.ts keeps the two the same). AgentZero's way home
// (relay.mjs quoteOk case g) delivers only into an account that runs one of them.
export const SAFE_CODE_HASHES = new Set([
  "8vPUrwYWp5cPDJGEuMg73d5tCJM29YkhytTsJR33AAyu",
  "FDfoE6vBv1bGjfxWgkXDh8FnEfLjKYFiUvDxUkQnPNL",
  "37vXrcdDnyy4eyW1dkE5FFcvCCTDwyYkaaaMNhcmDrVg",
  "DodJX5mzbkCC7jvYWjinuES37YnsqYH11p1DfA7Y3aF6",
  "5s2Poz7TSPZnwRtEQqF2xML93w8utbk6KtqfqCaXx1V",
  "vXFzGxpf6mC3e515soJu476Mxbu7uvo8pfAMgRqsqVL",
  "3JG7XVmCkhucxShYMtjJKCEFYdYNVNsG8QRL56FyJ4Fz",
  "3jT9F4RL115cMxuY7Dwc5RnaSSfqAUQ9F4Rhv4GHc8h4",
  "7QRGbHWttcP2ahWAbc5dTThTNHbjjA2d7MAKNd3C7FdX",
  "5vNK7eJcv5Tf2TYHwZTNhezwXRejWa4GneaeqAATfYzB",
  "396ARafA8YLDcorCdHyHgykmeLDAQNrrSNwAG6EUjqMP",
  "GuvwX4cqM6bt53AArbHhxkJwPBYWbj4SZJ9p6ApjMp17",
  "3NFQ7DrAoPLJ8iwfMvwz2koeFLkNJ65nHS4DxA61y5Kv",
  "HvALAxK1N5XPaAmvKjvToheN9A7YqpeUAGA5ioHHpzMu",
  "3bP1uKfKsUMZY6Xofxv6wZtjKrin2uvoPbeb9SZaKgsE",
  "99APpnLna3ZBB88KVaVQXAakPyBpaLiYujxanJ2FtE1e",
  "FeW2wSqQNdC9LXNaGyZdY81b6hYZAkAzaaqd7M2B7WRY",
  "BELFgu4XArJjV2BJBtcfG2L16vKnF2a222kPt28pTcoB",
  "5dvbBjU2boghQtkkoCUJeBofaheUwLjLUwnvMydC6Tf9",
  "6NvaDuhkYJVK6WMdywp4gqno9j6LpABeizNkiu429PYs",
]);
