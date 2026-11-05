// Starts the receiver: the SMTP side and the inbox API in one process, over one file store.
// Beyond loopback it needs a real key and certificate, and refuses to start without them: STARTTLS on the SMTP side,
// HTTPS on the inbox API (a read proof is a bearer for its 30 s, so the API is never served in the clear off this
// machine). On loopback, with no key, the API is plain HTTP for a TLS proxy in front of it, or for local runs.
import { createServer as createHttp, type Server } from "node:http";
import { createServer as createHttps } from "node:https";
import type { AddressInfo } from "node:net";
import { createHttpHandler, type HttpOptions } from "./http.ts";
import type { DkimOptions } from "./dkim.ts";
import { createSmtp, type MailSmtp, type SmtpLimits } from "./smtp.ts";
import { MailStore } from "./store.ts";

export interface StartOptions {
  dataDir: string;
  domain: string;
  /** 0 picks a free port. */
  smtpPort: number;
  httpPort: number;
  /** Where SMTP listens; 127.0.0.1 by default (an always-on box with port 25 open sets 0.0.0.0, with TLS). */
  host?: string;
  /** Where the inbox API listens; defaults to `host`. */
  httpHost?: string;
  size?: number;
  key?: string | Buffer;
  cert?: string | Buffer;
  http?: Omit<HttpOptions, "store" | "domain">;
  smtpLimits?: SmtpLimits;
  /** DKIM on arrival: on by default (node's DNS); "off" only on this machine, for tests. */
  dkim?: DkimOptions | "off";
  /** Counts and errors only: never a sender, a subject or a body. */
  log?: (line: string) => void;
}

export interface Running {
  store: MailStore;
  smtp: MailSmtp;
  http: Server;
  smtpPort: number;
  httpPort: number;
  close(): Promise<void>;
}

/** This machine only: 127.0.0.0/8, ::1, localhost. */
export const loopback = (host: string) => /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) || host === "::1" || host === "localhost";

export async function startMail(o: StartOptions): Promise<Running> {
  const log = o.log ?? (() => {});
  const host = o.host ?? "127.0.0.1";
  const httpHost = o.httpHost ?? host;
  const tls = Boolean(o.key && o.cert);
  if (!tls && (!loopback(host) || !loopback(httpHost)))
    throw new Error("mail: listening beyond this machine needs --tls-key and --tls-cert (STARTTLS and HTTPS); refusing to start");
  if (o.dkim === "off" && (!loopback(host) || !loopback(httpHost))) throw new Error("mail: DKIM can't be off beyond this machine; refusing to start");
  const store = new MailStore(o.dataDir);
  let stored = 0;
  const smtp = createSmtp({
    store,
    domain: o.domain,
    size: o.size,
    key: o.key,
    cert: o.cert,
    limits: o.smtpLimits,
    dkim: o.dkim,
    onStored: (copies) => {
      stored += copies;
      log(`mail: stored ${copies} sealed cop${copies === 1 ? "y" : "ies"} (${stored} since start)`);
    },
    onError: (what) => log(`mail: ${what}`),
  });
  const handle = createHttpHandler({ store, domain: o.domain, ...o.http });
  const onRequest: Parameters<typeof createHttp>[1] = (req, res) => {
    handle(req, res).catch(() => {
      log("mail: inbox api error");
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "server" }));
    });
  };
  const http: Server = tls ? (createHttps({ key: o.key, cert: o.cert }, onRequest) as unknown as Server) : createHttp(onRequest);
  await smtp.listen(o.smtpPort, host);
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(o.httpPort, httpHost, () => resolve());
  });
  return {
    store,
    smtp,
    http,
    smtpPort: smtp.address().port,
    httpPort: (http.address() as AddressInfo).port,
    close: () =>
      Promise.all([
        smtp.close(),
        new Promise<void>((r) => {
          http.closeAllConnections();
          http.close(() => r());
        }),
      ]).then(() => {}),
  };
}
