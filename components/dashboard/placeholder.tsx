export function DashboardPlaceholder({
  title,
  description,
  comingSoonLabel,
}: {
  title: string;
  description: string;
  comingSoonLabel: string;
}) {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
        <p className="text-sm text-slate-500">{description}</p>
        <p className="mt-1 text-xs font-medium uppercase tracking-wide text-brand-600">{comingSoonLabel}</p>
      </div>
    </div>
  );
}
