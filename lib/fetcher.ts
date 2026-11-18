import { lookup } from "node:dns/promises";
import net from "node:net";

export const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
// Representative AI-agent user agents (used to test whether bots get blocked).
export const AGENT_UA =
  "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)";

const MAX_BYTES = 3_000_000;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;

export interface FetchResult {
  ok: boolean;
  status: number;
  finalUrl: string;
  headers: Record<string, string>;
  body: string;
  bytes: number;
  ms: number;
  redirects: number;
  error?: string;
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 || a === 127 || a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateIp(v6.slice(7));
  return (
    v6 === "::1" || v6 === "::" ||
    v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80")
  );
}

/** Blocks requests to localhost / private networks (SSRF protection). */
async function assertPublicHost(url: URL) {
  if (process.env.ALLOW_PRIVATE_HOSTS === "1") return; // local testing only
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http(s) URLs are allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal"))
    throw new Error("Private hosts are not allowed");
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address)))
    throw new Error("Host resolves to a private address");
}

async function readCapped(res: Response): Promise<{ text: string; bytes: number }> {
  if (!res.body) return { text: "", bytes: 0 };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BYTES) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return { text: Buffer.concat(chunks).toString("utf8"), bytes };
}

export async function safeFetch(
  input: string,
  opts: { ua?: string; accept?: string; method?: "GET" | "HEAD" } = {}
): Promise<FetchResult> {
  const start = Date.now();
  let url = new URL(input);
  let redirects = 0;
  try {
    while (true) {
      await assertPublicHost(url);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const res = await fetch(url, {
        method: opts.method ?? "GET",
        redirect: "manual",
        signal: ctrl.signal,
        headers: {
          "user-agent": opts.ua ?? BROWSER_UA,
          accept: opts.accept ?? "text/html,application/xhtml+xml,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9",
        },
      }).finally(() => clearTimeout(timer));

      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        if (++redirects > MAX_REDIRECTS) throw new Error("Too many redirects");
        url = new URL(loc, url);
        continue;
      }
      const { text, bytes } = await readCapped(res);
      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => (headers[k] = v));
      return { ok: res.ok, status: res.status, finalUrl: url.toString(), headers, body: text, bytes, ms: Date.now() - start, redirects };
    }
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? "Timed out" : e.message) : String(e);
    return { ok: false, status: 0, finalUrl: url.toString(), headers: {}, body: "", bytes: 0, ms: Date.now() - start, redirects, error: msg };
  }
}

export function normalizeInputUrl(raw: string): URL {
  let s = raw.trim();
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  const u = new URL(s);
  u.hash = "";
  return u;
}
