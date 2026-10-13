import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Pagination({
  total,
  limit,
  offset,
  onOffset,
}: {
  total: number;
  limit: number;
  offset: number;
  onOffset: (offset: number) => void;
}) {
  if (total <= limit && offset === 0) return null;
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);
  return (
    <div className="flex items-center justify-between gap-2 pt-3 text-xs text-muted-foreground">
      <span className="num">
        {from}–{to} of {total}
      </span>
      <div className="flex gap-1">
        <Button
          size="sm"
          variant="outline"
          disabled={offset === 0}
          onClick={() => onOffset(Math.max(0, offset - limit))}
          aria-label="Previous page"
        >
          <ChevronLeft /> Prev
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={offset + limit >= total}
          onClick={() => onOffset(offset + limit)}
          aria-label="Next page"
        >
          Next <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
