// The frame for an app whose own session hasn't plugged its screens in yet. Same top bar, dots and tray as every app,
// so moving between apps can be tried today; the app's session replaces this with its AppModule.
import { useState } from "react";
import { Mark } from "@zerofee/design/Mark.tsx";
import { AppFrame, type TrayItem } from "@zerofee/shell-api/AppFrame.tsx";
import type { AppId, AppModule } from "@zerofee/shell-api/app-module.ts";
import { TrayOverview } from "@zerofee/design/icons.tsx";

const TRAY: TrayItem<"home">[] = [{ id: "home", label: "Home", icon: TrayOverview }];

export function AppPlaceholder({ name, promise }: { name: string; promise: string }) {
  const [tab, setTab] = useState<"home">("home");
  return (
    <AppFrame name={name} tray={TRAY} tab={tab} onTab={setTab}>
      <div style={{ height: "100%", display: "grid", placeItems: "center", textAlign: "center" }}>
        <div style={{ display: "grid", justifyItems: "center", gap: 22 }}>
          <Mark size={72} mode="still" />
          <h1 className="zf-title">{promise}</h1>
          <p className="zf-small">We're building the {name} app. It will open here.</p>
        </div>
      </div>
    </AppFrame>
  );
}

/** A stand-in AppModule until the app's own session registers the real one in apps.ts. */
export const placeholderApp = (id: AppId, name: string, promise: string, line: string): AppModule => ({
  id,
  name,
  line,
  Root: () => <AppPlaceholder name={name} promise={promise} />,
});
