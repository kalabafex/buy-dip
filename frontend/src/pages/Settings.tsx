import { useSettings } from "@/api/queries";
import { ErrorBox, Loading, PageHeader } from "@/components/common";
import { ModeCard } from "@/components/settings/ModeCard";
import { SettingsForm } from "@/components/settings/SettingsForm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function SettingsPage() {
  const settings = useSettings();
  if (settings.isPending) return <Loading />;
  if (settings.isError) return <ErrorBox error={settings.error} />;
  const s = settings.data;
  return (
    <div className="grid grid-cols-1 max-w-3xl gap-4">
      <PageHeader title="Settings" />
      <ModeCard settings={s} />
      <Card>
        <CardHeader>
          <CardTitle>Risk caps & schedule</CardTitle>
          <CardDescription>Global limits applied to every rule. Times are relative to the NYSE session.</CardDescription>
        </CardHeader>
        <CardContent>
          <SettingsForm settings={s} />
        </CardContent>
      </Card>
    </div>
  );
}
