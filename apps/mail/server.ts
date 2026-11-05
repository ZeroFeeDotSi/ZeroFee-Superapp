// AgentZero's mailbox receiver (D80), run by hand:
//   node apps/mail/server.ts --smtp 2525 --http 8787 --domain zerofee.si --data <dir> [--host 127.0.0.1]
//        [--http-host 127.0.0.1] [--api-host mail.zerofee.si] [--tls-key key.pem --tls-cert cert.pem] [--trust-proxy 1]
// Beyond loopback it refuses to start without --tls-key and --tls-cert. Logs counts and errors only.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { startMail } from "./src/start.ts";

const { values } = parseArgs({
  options: {
    smtp: { type: "string", default: "2525" },
    http: { type: "string", default: "8787" },
    domain: { type: "string", default: "zerofee.si" },
    data: { type: "string" },
    host: { type: "string", default: "127.0.0.1" },
    "http-host": { type: "string" },
    "api-host": { type: "string" },
    "tls-key": { type: "string" },
    "tls-cert": { type: "string" },
    "trust-proxy": { type: "string", default: "0" },
  },
});

if (!values.data) {
  process.stderr.write("mail: --data <dir> is required (where the sealed mail and the mailbox list live)\n");
  process.exit(2);
}

const hops = Number(values["trust-proxy"]);
const running = await startMail({
  dataDir: values.data,
  domain: values.domain!,
  smtpPort: Number(values.smtp),
  httpPort: Number(values.http),
  host: values.host,
  httpHost: values["http-host"],
  key: values["tls-key"] ? readFileSync(values["tls-key"]) : undefined,
  cert: values["tls-cert"] ? readFileSync(values["tls-cert"]) : undefined,
  http: { trustProxy: Number.isInteger(hops) && hops > 0 ? hops : 0, apiHost: values["api-host"] },
  log: (line) => process.stdout.write(`${line}\n`),
}).catch((err: Error) => {
  process.stderr.write(`${err.message}\n`);
  process.exit(2);
});

process.stdout.write(
  `mail: smtp on ${values.host}:${running.smtpPort}${values["tls-key"] ? " (STARTTLS)" : ""}, inbox api on ${values["http-host"] ?? values.host}:${running.httpPort}${values["tls-key"] ? " (HTTPS)" : ""}, ${running.store.size} mailbox(es), domain ${values.domain}\n`,
);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.once(sig, () => {
    void running.close().then(() => process.exit(0));
  });
}
