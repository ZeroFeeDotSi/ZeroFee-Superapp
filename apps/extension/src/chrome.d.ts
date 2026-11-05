// The few Chrome extension APIs this extension uses, typed by hand so the build needs no extra package.
declare namespace chrome {
  namespace runtime {
    const id: string;
    function getURL(path: string): string;
    interface MessageSender { id?: string; url?: string; frameId?: number; tab?: tabs.Tab }
    function sendMessage<T = unknown>(message: unknown): Promise<T>;
    const onMessage: { addListener(cb: (message: unknown, sender: MessageSender, reply: (response: unknown) => void) => boolean | void): void };
  }
  namespace storage {
    interface StorageArea {
      get(key: string): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(key: string): Promise<void>;
    }
    const local: StorageArea;
    const session: StorageArea & { setAccessLevel(o: { accessLevel: "TRUSTED_CONTEXTS" | "TRUSTED_AND_UNTRUSTED_CONTEXTS" }): Promise<void> };
    const onChanged: { addListener(cb: (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void): void; removeListener(cb: (...a: never[]) => void): void };
  }
  namespace sidePanel {
    function open(o: { tabId?: number; windowId?: number }): Promise<void>;
    function setPanelBehavior(o: { openPanelOnActionClick: boolean }): Promise<void>;
    function setOptions(o: { tabId?: number; path?: string; enabled?: boolean }): Promise<void>;
  }
  namespace windows {
    function create(o: { url?: string; type?: "normal" | "popup"; focused?: boolean; left?: number; top?: number; width?: number; height?: number }): Promise<{ id?: number }>;
    function remove(id: number): Promise<void>;
    const onRemoved: { addListener(cb: (windowId: number) => void): void };
  }
  namespace tabs {
    interface Tab { id?: number; url?: string; windowId?: number }
    function query(q: { active?: boolean; currentWindow?: boolean; lastFocusedWindow?: boolean }): Promise<Tab[]>;
    /** The tab this page is in; undefined in the side panel (panel/in-tab.ts). */
    function getCurrent(): Promise<Tab | undefined>;
    const onRemoved: { addListener(cb: (tabId: number) => void): void };
    const onActivated: { addListener(cb: (info: { tabId: number }) => void): void; removeListener(cb: (info: { tabId: number }) => void): void };
  }
}
