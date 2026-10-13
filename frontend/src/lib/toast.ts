import { errorText } from "@/api/client";

/** Minimal global toast store (rendered by <Toaster />). */
export type ToastVariant = "success" | "error" | "info";
export type ToastItem = { id: number; title: string; description?: string; variant: ToastVariant };

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<Listener>();
const DURATION_MS = { success: 4_500, info: 4_500, error: 8_000 } as const;

function emit() {
  for (const l of listeners) l(items);
}

export function dismissToast(id: number): void {
  items = items.filter((t) => t.id !== id);
  emit();
}

function push(variant: ToastVariant, title: string, description?: string): number {
  const id = nextId++;
  items = [...items.slice(-3), { id, title, description, variant }];
  emit();
  window.setTimeout(() => dismissToast(id), DURATION_MS[variant]);
  return id;
}

export const toast = {
  success: (title: string, description?: string) => push("success", title, description),
  info: (title: string, description?: string) => push("info", title, description),
  error: (title: string, error?: unknown) =>
    push("error", title, error === undefined ? undefined : errorText(error)),
};

export function subscribeToasts(fn: Listener): () => void {
  listeners.add(fn);
  fn(items);
  return () => listeners.delete(fn);
}
