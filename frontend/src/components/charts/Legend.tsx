
export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1">
          <span
            className="inline-block w-4"
            style={{ borderTop: `2px ${i.dashed ? "dashed" : "solid"} ${i.color}` }}
          />
          {i.label}
        </span>
      ))}
    </div>
  );
}
