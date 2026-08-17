// pdf-parse's package root (index.js) has a bundler-unsafe debug entrypoint
// — see the comment in pdf.ts — so we import its internal parser module
// directly instead, which @types/pdf-parse doesn't cover.
declare module "pdf-parse/lib/pdf-parse.js" {
  function pdfParse(dataBuffer: Buffer, options?: unknown): Promise<{ text: string }>;
  export default pdfParse;
}
