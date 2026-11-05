// The panel page (panel.html), in Chrome's side panel. White by default; black when the person picks it in Settings.
import { createRoot } from "react-dom/client";
import "@zerofee/design/tokens.css";
import "@zerofee/design/ui.css";
import "@zerofee/trade/app/trade.css";
import "./panel.css";
import { Panel } from "./Panel.tsx";
import { local, PanelProvider } from "./runtime.tsx";

void local.get<string>("theme").then((t) => { document.documentElement.dataset.theme = t === "dark" ? "dark" : "light"; });
createRoot(document.getElementById("root")!).render(<PanelProvider><Panel /></PanelProvider>);
