// The web wallet's one page for what lives on the phone (product decision, 4 Nov): the Browser, pump.fun and GMGN (a site
// can't be framed in a web page, and a popup has no wallet), and any way in to the Safe, AgentZero or Private. One
// component, one layout, everywhere: full screen (D135, Close, a size that never changes), the app's icon, "On your
// phone", one reason line, and Get the phone app.
import type { ReactNode } from "react";
import { Mark } from "@zerofee/design/Mark.tsx";
import { Sheet } from "@zerofee/design/Sheet.tsx";
import { PHONE_APP_URL, PHONE_PAGE, phoneReason, type PhoneReason } from "./web-wallet-words.ts";
import "./onyourphone.css";

export function OnYourPhone({ reason, name, icon, onClose }: { reason: PhoneReason; /** a site's name */ name?: string; /** the app's icon (default: ZeroFee's mark) */ icon?: ReactNode; onClose: () => void }) {
  return (
    <Sheet onClose={onClose}>
      <div className="oyp" data-testid="on-your-phone" data-reason={reason}>
        <div className="oyp__icon" aria-hidden="true">{icon ?? <Mark size={64} mode="still" />}</div>
        <h2 className="zf-title oyp__title">{PHONE_PAGE.title}</h2>
        <p className="zf-body oyp__why">{phoneReason(reason, name)}</p>
        <a className="zf-btn oyp__go" href={PHONE_APP_URL} target="_blank" rel="noopener noreferrer">{PHONE_PAGE.button}</a>
      </div>
    </Sheet>
  );
}
