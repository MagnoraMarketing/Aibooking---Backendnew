import "server-only";
// Pinned to the old 1.x line deliberately: pdf-parse@2's Node entry pulls in
// pdfjs-dist's "legacy" build, which tries to polyfill DOMMatrix/canvas at
// import time and throws in Vercel's serverless runtime (no @napi-rs/canvas
// there) — crashing at require-time, not call-time, so it broke every route
// that merely imported this module, not just PDF uploads themselves. 1.x
// vendors its own text-only parser with no such dependency.
//
// Importing from the package root (`pdf-parse`) has its own bundler trap:
// its index.js has a leftover debug snippet gated on `!module.parent`, which
// misreads as "true" once webpack bundles it, and tries to
// read a test fixture (./test/data/05-versions-space.pdf) that doesn't
// exist in the deployed bundle — crashing at import time again. Importing
// the actual parser module directly skips that debug entrypoint entirely.
import pdfParse from "pdf-parse/lib/pdf-parse.js";

export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const result = await pdfParse(buffer);
  return result.text.trim();
}
