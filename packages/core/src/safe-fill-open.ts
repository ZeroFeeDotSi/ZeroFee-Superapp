// Move and a site's top-up pay from Private (private-route.ts). When Private is short, the Safe → Private fill (route B)
// opens ONLY for that route. It is handed to the route as a parameter, never by turning route B
// (CONVERT_ROUTES.nearOrigin) on for everyone: every other route B caller still sees it closed. Its own file, so Home's
// first load carries this one line and none of the route.
// Open in every build (QA's real-money lap, 5 Nov: closed, a Safe → SOL wallet Move said "Job created", then
// "Private is empty. Filling it from your Safe isn't open yet." with $3.35 in Private, a gate with no path). The Move's
// Private leg and Safe leg to one wallet are one approval (fix/new-safe-move-4). Tests may still pass `safeFillOpen: false`.
export const SAFE_FILL_OPEN: boolean = true;
