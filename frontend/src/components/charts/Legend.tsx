import type { ReactNode } from "react";

export type LegendItem = {
  label: string;
  color: string;
  dashed?: boolean;
  value?: ReactNode;
  marker?: "line" | "arrow";
};

/**
 * Line-key legend. With `value`s it doubles as the crosshair readout (values lead,
 * labels follow; text stays in ink, the colored key carries identity).
 */
export function Legend({ items, title }: { items: LegendItem[]; title?: ReactNode }) {
  return (
    <div className="flex min-h-[1.25rem] flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      {title && <span className="num font-medium text-muted-foreground">{title}</span>}
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5 text-muted-foreground">
          {i.marker === "arrow" ? (
            <span aria-hidden className="text-[10px] leading-none" style={{ color: i.color }}>
              ▲
            </span>
          ) : (
            <span
              aria-hidden
              className="inline-block w-4 rounded-full"
              style={{ borderTop: `2px ${i.dashed ? "dashed" : "solid"} ${i.color}` }}
            />
          )}
          {i.value !== undefined && <span className="num font-semibold text-foreground">{i.value}</span>}
          <span>{i.label}</span>
        </span>
      ))}
    </div>
  );
}
