// One confirm before something leaves Pay (the robot's walk): what Pay forgets, where the money stays, one button.
import { Sheet } from "@zerofee/design/Sheet.tsx";

export function RemoveSheet({ name, line, onRemove, onClose }: { name: string; line: string; onRemove: () => void; onClose: () => void }) {
  return (
    <Sheet title={`Remove ${name}`} onClose={onClose}>
      <p className="zf-body">{line}</p>
      <div className="py-floor" style={{ marginTop: 18 }}>
        <button className="zf-btn" onClick={onRemove}>Remove {name}</button>
      </div>
    </Sheet>
  );
}
