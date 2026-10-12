import { ImageResponse } from "next/og";

// PNG app icon in the sizes the manifest and iOS ask for.
export function GET(_request: Request, { params }: { params: { size: string } }) {
  const requested = Number(params.size.replace(/\.png$/, ""));
  const size = [180, 192, 512].includes(requested) ? requested : 192;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(145deg, #3866f5, #1f3ea8)",
          color: "white",
          fontSize: size * 0.42,
          fontWeight: 700,
          letterSpacing: -size * 0.01,
        }}
      >
        AI
      </div>
    ),
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=86400, immutable" } }
  );
}
