// Runs before any app code (main.ts imports it first): from here on, every passkey moment of the app's page (making the
// key, the unlock, the fresh check) opens the extension's own window instead of running in the narrow side panel.
import { installWindowCredentials } from "../../../web/src/host/extension.ts";

installWindowCredentials();
