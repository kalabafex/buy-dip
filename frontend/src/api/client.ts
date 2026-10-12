/**
 * Small typed fetch client over the generated OpenAPI `paths` types.
 *
 *   const rule = await api.get("/api/rules/{rule_id}", { path: { rule_id } });
 *   await api.patch("/api/rules/{rule_id}/enabled", { path: { rule_id }, body: { enabled } });
 *
 * All requests are same-origin (Vite dev proxy / nginx) and send cookies.
 */
import type { components, paths } from "./schema";

export type Schemas = components["schemas"];

type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

type PathsFor<M extends HttpMethod> = {
  [P in keyof paths]: paths[P][M] extends undefined ? never : P;
}[keyof paths];

type Op<P extends keyof paths, M extends HttpMethod> = NonNullable<paths[P][M]>;

type PathParams<O> = O extends { parameters: { path: infer X } } ? X : never;
type QueryParams<O> = O extends { parameters: { query?: infer Q } } ? NonNullable<Q> : never;
type JsonBody<O> = O extends { requestBody: { content: { "application/json": infer B } } }
  ? B
  : never;

type SuccessCode = 200 | 201;
type SuccessJson<O> = O extends { responses: infer R }
  ? {
      [K in keyof R & SuccessCode]: R[K] extends { content: { "application/json": infer J } }
        ? J
        : never;
    }[keyof R & SuccessCode]
  : never;
type Result<O> = [SuccessJson<O>] extends [never] ? void : SuccessJson<O>;

type Opts<O> = ([PathParams<O>] extends [never] ? { path?: undefined } : { path: PathParams<O> }) &
  ([QueryParams<O>] extends [never] ? { query?: undefined } : { query?: QueryParams<O> }) &
  ([JsonBody<O>] extends [never] ? { body?: undefined } : { body: JsonBody<O> }) & {
    signal?: AbortSignal;
  };

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type Args<O> = {} extends Opts<O> ? [opts?: Opts<O>] : [opts: Opts<O>];

/** Request/response types by path + method, for use in components. */
export type ResponseOf<P extends keyof paths, M extends HttpMethod> = Result<Op<P, M>>;
export type BodyOf<P extends keyof paths, M extends HttpMethod> = JsonBody<Op<P, M>>;
export type QueryOf<P extends keyof paths, M extends HttpMethod> = QueryParams<Op<P, M>>;

type ValidationItem = { loc: (string | number)[]; msg: string };

export class ApiError extends Error {
  readonly status: number;
  /** FastAPI `detail`: a string, or a list of validation errors. */
  readonly detail: unknown;

  constructor(status: number, detail: unknown, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }

  /** Validation errors keyed by dotted field path (without the leading "body"). */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    if (Array.isArray(this.detail)) {
      for (const item of this.detail as ValidationItem[]) {
        const key = fieldPath(item.loc);
        if (key && !(key in out)) out[key] = item.msg;
      }
    }
    return out;
  }
}

export function isApiError(e: unknown, status?: number): e is ApiError {
  return e instanceof ApiError && (status === undefined || e.status === status);
}

function fieldPath(loc: (string | number)[] | undefined): string {
  if (!Array.isArray(loc)) return "";
  const parts = loc[0] === "body" || loc[0] === "query" || loc[0] === "path" ? loc.slice(1) : loc;
  return parts.join(".");
}

function detailMessage(detail: unknown): string | null {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return (detail as ValidationItem[])
      .map((d) => {
        const where = fieldPath(d.loc);
        const msg = (d.msg ?? "").replace(/^Value error, /, "");
        return where ? `${where}: ${msg}` : msg;
      })
      .join("; ");
  }
  return null;
}

function errorMessage(status: number, detail: unknown, statusText: string): string {
  const d = detailMessage(detail);
  switch (status) {
    case 401:
      return d && d !== "not authenticated" ? humanDetail(d) : "Not signed in";
    case 403:
      return d ? humanDetail(d) : "Re-authentication required";
    case 429:
      return "Too many attempts. Wait a minute and try again.";
    case 503:
      return `Service unavailable${d ? `: ${d}` : " (market data or broker unreachable)"}`;
    default:
      return d ?? `${status} ${statusText || "Request failed"}`;
  }
}

function humanDetail(d: string): string {
  return d.charAt(0).toUpperCase() + d.slice(1);
}

let unauthorizedHandler: (() => void) | null = null;

/** Called for any 401 outside /api/auth/* (session expired → go to login). */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

function buildUrl(
  template: string,
  path: Record<string, unknown> | undefined,
  query: Record<string, unknown> | undefined,
): string {
  let url = template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = path?.[name];
    if (v === undefined || v === null) throw new Error(`missing path param ${name}`);
    return encodeURIComponent(String(v));
  });
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      if (Array.isArray(v)) v.forEach((x) => qs.append(k, String(x)));
      else qs.append(k, String(v));
    }
    const s = qs.toString();
    if (s) url += `?${s}`;
  }
  return url;
}

async function request(
  method: HttpMethod,
  template: string,
  opts: {
    path?: Record<string, unknown>;
    query?: Record<string, unknown>;
    body?: unknown;
    signal?: AbortSignal;
  } = {},
): Promise<unknown> {
  const url = buildUrl(template, opts.path, opts.query);
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(url, {
      method: method.toUpperCase(),
      headers,
      body,
      credentials: "include",
      signal: opts.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(0, null, "Network error: cannot reach the API");
  }
  if (res.status === 204) return undefined;
  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const detail =
      data && typeof data === "object" && "detail" in data
        ? (data as { detail: unknown }).detail
        : data;
    if (res.status === 401 && !template.startsWith("/api/auth/")) unauthorizedHandler?.();
    throw new ApiError(res.status, detail, errorMessage(res.status, detail, res.statusText));
  }
  return data;
}

function method<M extends HttpMethod>(m: M) {
  return <P extends PathsFor<M>>(path: P, ...args: Args<Op<P, M>>): Promise<Result<Op<P, M>>> =>
    request(m, path, (args[0] ?? {}) as Parameters<typeof request>[2]) as Promise<
      Result<Op<P, M>>
    >;
}

export const api = {
  get: method("get"),
  post: method("post"),
  put: method("put"),
  patch: method("patch"),
  delete: method("delete"),
};

/** Human message for any thrown value. */
export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
