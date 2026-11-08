// Ask NEAR AI Cloud (OpenAI-compatible, cloud-api.near.ai) about the person's own Activity, inside a private enclave,
// and check the enclave's attestation with a fresh nonce. Only the person's own Activity rows (date, what, dollars) go
// to the model: no keys, no addresses beyond the names already on those rows, no balances.
//
// The attestation report needs no key (GET /v1/attestation/report). The answer needs the person's own NEAR AI key; with
// none, the app shows a recorded answer and says so (testing/nearai-recorded.ts).

export const NEAR_AI = "https://cloud-api.near.ai/v1";
/** An open model NEAR AI runs in a TEE (Intel TDX + NVIDIA confidential GPU), listed on /v1/models on 2 Nov. */
export const MODEL = "deepseek-ai/DeepSeek-V4.1-Flash-1017";

export interface ActivityLine {
  atIso: string;
  title: string;
  usd?: string;
}

/** What is sent: one line per row, nothing else. */
export function activityText(rows: readonly ActivityLine[]): string {
  return rows.map((r) => `${r.atIso.slice(0, 10)} | ${r.title}${r.usd ? ` | $${r.usd}` : ""}`).join("\n");
}

export const SYSTEM = [
  "You answer questions about one person's own money activity, in plain words a child can read.",
  "Use only the activity lines given. If they don't say, answer that you can't tell from their activity.",
  "Answer in one or two short sentences, with dollar amounts. Never give instructions to pay anyone.",
].join(" ");

export type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** The request body: the system rule, the person's own Activity, the question. */
export function chatBody(question: string, rows: readonly ActivityLine[], model = MODEL) {
  return {
    model,
    messages: [
      { role: "system", content: SYSTEM },
      { role: "user", content: `My activity:\n${activityText(rows)}\n\nMy question: ${question}` },
    ],
    max_tokens: 200,
    temperature: 0,
  };
}

export interface Answer {
  text: string;
  /** The completion's id, for its signature (GET /v1/signature/{id}). */
  chatId?: string;
  model: string;
}

/** Ask. Throws `NearAiError` (named for the screen) when NEAR AI Cloud doesn't answer or says no. */
export async function ask(question: string, rows: readonly ActivityLine[], apiKey: string, fetchFn: Fetch = fetch as unknown as Fetch): Promise<Answer> {
  let r;
  try {
    r = await fetchFn(`${NEAR_AI}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify(chatBody(question, rows)), signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new NearAiError("NEAR AI Cloud didn't answer.");
  }
  if (r.status === 401 || r.status === 403) throw new NearAiError("NEAR AI Cloud didn't accept your key.");
  if (!r.ok) throw new NearAiError("NEAR AI Cloud didn't answer.");
  const j = (await r.json()) as { id?: string; model?: string; choices?: { message?: { content?: string } }[] };
  const text = j.choices?.[0]?.message?.content?.trim();
  if (!text) throw new NearAiError("NEAR AI Cloud didn't answer.");
  return { text, chatId: j.id, model: j.model ?? MODEL };
}

export class NearAiError extends Error {}

/** A fresh 32-byte nonce, hex. */
export function freshNonce(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return [...random(32)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface Proof {
  nonce: string;
  model: string;
  /** Each check, said plainly, and whether it held. */
  checks: { label: string; ok: boolean }[];
  /** What this phone can't check itself, said once. */
  notHere: string;
  enclaveKey?: string;
  ok: boolean;
}

/** The 64-byte report_data inside an Intel TDX quote (v4: a 48-byte header, report_data at 520 in the TD report). */
export function quoteReportData(quoteHex: string): string | null {
  const start = (48 + 520) * 2;
  return quoteHex.length >= start + 128 ? quoteHex.slice(start, start + 128).toLowerCase() : null;
}

/**
 * Check an attestation report against our nonce: the nonce came back (gateway and model), the enclave's report data binds
 * its signing address and our nonce, and that report data is the one inside the Intel TDX quote; NVIDIA's GPU evidence
 * names our nonce; the model is the one asked. Intel's and NVIDIA's signatures on that evidence need their certificate
 * services: this phone doesn't check those (NEAR AI's verifier does, cloud.near.ai/verify).
 */
export function checkReport(report: unknown, nonce: string, model = MODEL): Proof {
  const r = report as { gateway_attestation?: Att; model_attestations?: Att[] };
  const g = r?.gateway_attestation;
  const m = r?.model_attestations?.find((a) => a.model_name === model) ?? r?.model_attestations?.[0];
  const n = nonce.toLowerCase();
  const binds = (a?: Att) => {
    // The quote's own report data (the model's report has no separate field; the gateway's must equal it).
    const inQuote = quoteReportData(a?.intel_quote ?? "");
    if (!inQuote || !a?.signing_address || (a.report_data && a.report_data.toLowerCase() !== inQuote)) return false;
    const addr = a.signing_address.toLowerCase().replace(/^0x/, "");
    return addr.length === 40 && inQuote.startsWith(addr) && inQuote.endsWith(n);
  };
  let gpuNonce = false;
  try {
    gpuNonce = String((JSON.parse(m?.nvidia_payload ?? "{}") as { nonce?: string }).nonce ?? "").toLowerCase() === n;
  } catch {
    gpuNonce = false;
  }
  const checks = [
    { label: "The fresh number came back from NEAR AI's gateway", ok: g?.request_nonce?.toLowerCase() === n },
    { label: "The gateway's Intel chip report names it", ok: binds(g) },
    { label: "The fresh number came back from the model's sealed computer", ok: m?.request_nonce?.toLowerCase() === n },
    { label: "The model's Intel chip report names it", ok: binds(m) },
    { label: "The model's NVIDIA GPU evidence names it", ok: gpuNonce },
    { label: `It is the model ZeroFee asked for (${model})`, ok: m?.model_name === model },
  ];
  return { nonce: n, model, checks, notHere: "NEAR AI's checker, not this phone, checks Intel's and NVIDIA's seals on these reports.", enclaveKey: m?.signing_address, ok: checks.every((c) => c.ok) };
}

interface Att {
  model_name?: string;
  signing_address?: string;
  request_nonce?: string;
  report_data?: string;
  intel_quote?: string;
  nvidia_payload?: string;
}

/** Fetch the attestation for `model` with a fresh nonce, and check it. Needs no key. */
/** How long NEAR AI Cloud's proof may take (attest's deadline; AgentZero's screen counts it down, read-left.ts). */
export const ATTEST_MS = 30_000;

export async function attest(model = MODEL, fetchFn: Fetch = fetch as unknown as Fetch, nonce = freshNonce()): Promise<Proof> {
  let r;
  try {
    r = await fetchFn(`${NEAR_AI}/attestation/report?model=${encodeURIComponent(model)}&signing_algo=ecdsa&nonce=${nonce}`, { signal: AbortSignal.timeout(ATTEST_MS) });
  } catch {
    throw new NearAiError("NEAR AI Cloud didn't send its proof.");
  }
  if (!r.ok) throw new NearAiError("NEAR AI Cloud didn't send its proof.");
  return checkReport(await r.json(), nonce, model);
}
