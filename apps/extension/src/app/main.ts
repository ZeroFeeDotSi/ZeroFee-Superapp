// D157: the ZeroFee app in the extension's side panel: the web app (apps/web), bundled into the extension's own page. First,
// this page's passkey requests are pointed at the extension's own full-screen window (host/extension.ts), then the app.
import "./credentials.ts";
import "../../../web/src/main.tsx";
