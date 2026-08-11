import { notFound } from "next/navigation";
import Script from "next/script";
import { getWidgetBundleByPublicId, toPublicWidgetConfig } from "@/lib/widgets";

export const dynamic = "force-dynamic";

export default async function WidgetSharePage({ params }: { params: { publicId: string } }) {
  const bundle = await getWidgetBundleByPublicId(params.publicId);
  if (!bundle) notFound();

  const config = toPublicWidgetConfig(bundle);

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: config.secondaryColor,
        color: "#fff",
        textAlign: "center",
        padding: "2rem",
      }}
    >
      <div>
        <h1 style={{ marginBottom: "0.5rem" }}>{config.businessName ?? "AI-assistent"}</h1>
        <p style={{ opacity: 0.8 }}>{config.welcomeMessage ?? "Klik på chatikonet for at komme i gang."}</p>
      </div>
      <Script src="/widget.js" data-widget-id={config.publicId} strategy="afterInteractive" />
    </main>
  );
}
