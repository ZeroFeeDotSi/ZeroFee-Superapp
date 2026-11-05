// the Home plan §5, D125 (security review L9; product decision, 3 Nov): Home's two-leg moves through the NEAR wallet
// (E5: one chain's wallet to another's; E7: the Safe's NEAR to its own USDC) run only in a build made with
// VITE_HOME_PROOF=1: the test build, where the $1 proof runs in the app. A release build hides them (never listed,
// never callable) until that proof passes; then this one line turns them on for everyone. The public web build is made
// with it on (product decision, 3 Nov: Home's Add, Send, Swap and Move live in the web's Real mode; deploy-app.sh), and its
// core is the page's own, so it reads the same flag.
// Written as import.meta.env?.VITE_… so the bundler replaces it with its literal; under node (tests) it reads as off, and
// the tests that run E5 and E7 turn it on by hand (createSpendingService's homeProof, the sheets' `pairs`).
export const HOME_PROOF: boolean = false || import.meta.env?.VITE_HOME_PROOF === "1";
