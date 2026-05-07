/**
 * Tiny HTTP probe helpers used by the compliance test suite.
 *
 * Centralised so every test reports failures in the same format:
 * "request URL → got status X, expected Y" plus the response body
 * if the probe parses one. That uniformity is the difference
 * between a maintainer running the suite against their own cloud
 * and seeing a clean diagnosis vs. trying to reverse-engineer a
 * cryptic vitest assertion failure.
 */

export interface ProbeResponse {
  status: number;
  ok: boolean;
  headers: Headers;
  body: unknown;
  raw: string;
}

export interface ProbeOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  bearer?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export async function probe(url: string, opts: ProbeOptions = {}): Promise<ProbeResponse> {
  const headers: Record<string, string> = {
    accept: "application/json",
    ...(opts.headers ?? {}),
  };
  if (opts.bearer && opts.bearer.length > 0) {
    headers.authorization = `Bearer ${opts.bearer}`;
  }
  let bodyInit: BodyInit | undefined;
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    bodyInit = JSON.stringify(opts.body);
  }
  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers,
    body: bodyInit,
  });
  const raw = await res.text();
  let body: unknown = null;
  if (raw.length > 0) {
    try {
      body = JSON.parse(raw);
    } catch {
      // Non-JSON bodies are still surfaced via `raw`. Leaving `body`
      // null so tests that explicitly require JSON shape fail cleanly.
      body = null;
    }
  }
  return { status: res.status, ok: res.ok, headers: res.headers, body, raw };
}
