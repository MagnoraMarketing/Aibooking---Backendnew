export default function HomePage() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "4rem 2rem", maxWidth: 720, margin: "0 auto" }}>
      <h1>AIbooking.dk</h1>
      <p>Multi-tenant SaaS backend for AI voice widgets.</p>
      <p>
        This deployment exposes the platform API (see <code>/api/*</code>) and the embeddable widget loader at{" "}
        <code>/widget.js</code>. The admin and customer dashboards are separate frontend deliverables that consume
        this API.
      </p>
    </main>
  );
}
