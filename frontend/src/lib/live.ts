import type { QueryClient } from "@tanstack/react-query";
import type { Schemas } from "@/api/client";
import { num } from "@/lib/picks";

export type PicksQuotes = Schemas["PicksQuotesOut"];
export type SymbolQuotes = Schemas["SymbolQuotes"];

/** A live price is considered stale after this long without a new sample. */
export const STALE_AFTER_MS = 90_000;
const MAX_POINTS = 600;

type QuoteEvent = {
  session_date: string;
  quotes: { symbol: string; price: string; open: string; ts: string }[];
};

function parse(data: string): QuoteEvent | null {
  try {
    const v = JSON.parse(data) as Partial<QuoteEvent>;
    return typeof v.session_date === "string" && Array.isArray(v.quotes) ? (v as QuoteEvent) : null;
  } catch {
    return null;
  }
}

function changePct(price: string, open: string): string {
  const p = Number(price);
  const o = Number(open);
  return o > 0 ? ((p / o - 1) * 100).toFixed(4) : "0";
}

/** Merge one SSE `picks_quote` event into every cached quotes query for that day. */
export function mergeQuotes(prev: PicksQuotes, ev: QuoteEvent): PicksQuotes {
  if (prev.session_date !== ev.session_date) return prev;
  const bySymbol = new Map(prev.quotes.map((q) => [q.symbol, q]));
  for (const q of ev.quotes) {
    const cur = bySymbol.get(q.symbol);
    if (cur && cur.ts >= q.ts) continue; // out of order or duplicate
    const point = { ts: q.ts, price: q.price };
    const series = cur ? [...cur.series, point].slice(-MAX_POINTS) : [point];
    bySymbol.set(q.symbol, {
      symbol: q.symbol,
      last: q.price,
      open: q.open,
      change_pct: changePct(q.price, q.open),
      ts: q.ts,
      series,
    });
  }
  const quotes = [...bySymbol.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
  const as_of = quotes.reduce<string | null>((m, q) => (m === null || q.ts > m ? q.ts : m), null);
  return { ...prev, quotes, as_of };
}

export function applyQuoteEvent(qc: QueryClient, data: string): void {
  const ev = parse(data);
  if (!ev) return;
  qc.setQueriesData<PicksQuotes>({ queryKey: ["picksQuotes"] }, (prev) => (prev ? mergeQuotes(prev, ev) : prev));
}

export type Live = {
  price: number;
  open: number;
  changePct: number;
  ts: number;
  series: number[];
};

export function liveMap(data: PicksQuotes | undefined): Map<string, Live> {
  const m = new Map<string, Live>();
  for (const q of data?.quotes ?? []) {
    m.set(q.symbol, {
      price: num(q.last) ?? 0,
      open: num(q.open) ?? 0,
      changePct: num(q.change_pct) ?? 0,
      ts: Date.parse(q.ts),
      series: q.series.map((p) => num(p.price) ?? 0),
    });
  }
  return m;
}
