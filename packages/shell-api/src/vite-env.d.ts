// The build flags the app's code reads, each as `import.meta.env.VITE_X` or `import.meta.env?.VITE_X` (the `?.` form
// also runs under node tests, where import.meta.env is undefined): the forms Vite writes as a literal at build time, so a
// build without a flag drops the code behind it (tools/test/env-reads.test.ts refuses any other form). A flag is a string
// ("1" on) or absent. apps/web's typecheck includes this folder; apps/extension's references this file.
interface ImportMetaEnv {
  readonly VITE_AGENT_BROWSER?: string;
  readonly VITE_AGENT_LIVE_ORIGINS?: string;
  readonly VITE_AGENTZERO_CHAT?: string;
  readonly VITE_AGENTZERO_OWN_KEY?: string;
  readonly VITE_CODE_URL?: string;
  readonly VITE_FORK?: string;
  readonly VITE_HOME_PROOF?: string;
  readonly VITE_NATIVE_COINS?: string;
  readonly VITE_TEST_TRACE?: string;
  readonly VITE_TEST_TRACE_ID?: string;
  readonly VITE_TEST_TRACE_KEY?: string;
  readonly VITE_WEB_SEND_TOKENS?: string;
  readonly VITE_WEB_TRADE?: string;
  readonly VITE_ZEROFEE_EXTENSION_CHECK?: string;
  readonly VITE_ZEROFEE_FREE?: string;
  readonly VITE_ZEROFEE_PERPS_WALK?: string;
  readonly VITE_ZEROFEE_PUBLIC?: string;
  readonly VITE_ZEROFEE_RELAY?: string;
  readonly VITE_ZEROFEE_TARGET?: string;
  readonly VITE_ZF_TEST_LANE?: string;
}
