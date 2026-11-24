/** Comparing two PDFs. Nothing here touches a file, so it is tested with plain Node.js. */

/**
 * A PDF as text of one character a byte, without what the LaTeX program
 * writes anew on every run: the time it was made, and the sign it makes of
 * that time. Their lengths do not change, so the rest stays byte for byte.
 */
function withoutTimes(pdf: Uint8Array): string {
  return new TextDecoder("latin1")
    .decode(pdf)
    .replace(/\/(CreationDate|ModDate)\s*\(D:[^)]*\)/g, "/$1()")
    .replace(/\/ID\s*\[\s*<[0-9A-Fa-f]*>\s*<[0-9A-Fa-f]*>\s*\]/g, "/ID[]");
}

/**
 * True when two PDFs are the same but for the time they were made.
 *
 * A PDF that is built again from the same LaTeX then is not written again:
 * a vault that is kept in version control or synced would otherwise get a
 * changed file with every build.
 */
export function samePdf(one: Uint8Array, other: Uint8Array): boolean {
  return one.byteLength === other.byteLength && withoutTimes(one) === withoutTimes(other);
}

/** How many pages the LaTeX program says it wrote, or null when it does not say */
export function pagesOf(log: string): number | null {
  const said = /Output written on [^\n]*?\((\d+) pages?/.exec(log.replace(/\r?\n/g, " "));
  return said === null ? null : Number(said[1]);
}
