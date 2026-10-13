import { SlidersHorizontal } from "lucide-react";
import { useSettings } from "@/api/queries";
import { ErrorBox, PageHeader, PageSkeleton } from "@/components/common";
import { ModeCard } from "@/components/settings/ModeCard";
import { SettingsForm } from "@/components/settings/SettingsForm";
import { Card, CardContent, CardHeaderRow } from "@/components/ui/card";

export function SettingsPage() {
  const settings = useSettings();
  if (settings.isPending) return <PageSkeleton />;
  if (settings.isError) return <ErrorBox error={settings.error} />;
  const s = settings.data;
  return (
    <div className="grid max-w-4xl grid-cols-1 gap-5">
      <PageHeader title="Settings" subtitle="Trading mode, global spend caps and the evaluation schedule." />
      <ModeCard settings={s} />
      <Card>
        <CardHeaderRow
          title={
            <>
              <SlidersHorizontal className="h-4 w-4 text-muted-foreground" aria-hidden /> Risk caps &amp;
              schedule
            </>
          }
          description="Global limits applied across every rule. Times are relative to the NYSE session."
        />
        <CardContent>
          <SettingsForm settings={s} />
        </CardContent>
      </Card>
    </div>
  );
}
