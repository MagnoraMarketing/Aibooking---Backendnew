import type { WidgetWithExtras } from "../agent-configurator";

export function TestAgentTab({ widget }: { widget: WidgetWithExtras }) {
  if (widget.status !== "active") {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <p className="text-sm text-slate-500">
          Agenten er sat på pause. Aktivér den under &quot;Dine agenter&quot; for at teste den live.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <iframe
          src={widget.shareUrl}
          title="Test agent"
          className="h-[560px] w-full"
          sandbox="allow-scripts allow-same-origin allow-forms"
          allow="microphone; autoplay"
        />
      </div>
      <p className="text-sm text-slate-500">
        Dette er den rigtige widget, live — samtaler her tæller med i forbrug og statistik ligesom på jeres
        hjemmeside.{" "}
        <a href={widget.shareUrl} target="_blank" rel="noreferrer" className="font-medium text-brand-600">
          Åbn i nyt vindue ↗
        </a>
      </p>
    </div>
  );
}
