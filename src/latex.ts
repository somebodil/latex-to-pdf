/** Reading the LaTeX out of a note, and reading what the LaTeX program says. Nothing here touches a file, so it is tested with plain Node.js. */

const FENCE = /^(`{3,}|~{3,})[ \t]*([^\n`]*)\n([\s\S]*?)\n\1[ \t]*$/gm;

/**
 * The LaTeX document a note holds, or null when it holds none.
 *
 * A note keeps the document in a block of code, so that Obsidian shows it as
 * it is written. The first block that is marked as LaTeX, or that starts a
 * document, is the one. A note that is nothing but the document, without a
 * block around it, is taken whole, without its properties.
 */
export function latexOf(note: string): string | null {
  const text = note.replace(/\r\n/g, "\n");
  FENCE.lastIndex = 0;
  for (let block = FENCE.exec(text); block !== null; block = FENCE.exec(text)) {
    const kind = (block[2] ?? "").trim().toLowerCase();
    const body = block[3] ?? "";
    if (kind === "latex" || kind === "tex" || body.includes("\\documentclass")) {
      return body.trimEnd() + "\n";
    }
  }
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, "");
  return body.includes("\\documentclass") && !body.includes("```") ? body.trim() + "\n" : null;
}

/** True for a note that is named as a LaTeX document: `Name.tex.md` */
export function isLatexNote(path: string): boolean {
  return /\.tex\.md$/i.test(path);
}

/** Where the PDF of a note is written: beside the note, under its name. `Folder/Resume.tex.md` gives `Folder/Resume.pdf`. */
export function pdfPathOf(notePath: string): string {
  return notePath.replace(/(\.tex)?\.md$/i, "") + ".pdf";
}

/**
 * What went wrong, from what the LaTeX program wrote: its errors start with
 * an exclamation mark, or with the name of the file and a line number, and
 * the line after says where. The first few are enough to find the mistake.
 */
export function errorOf(log: string): string {
  const lines = log.replace(/\r\n/g, "\n").split("\n");
  const found: string[] = [];
  for (let at = 0; at < lines.length && found.length < 6; at++) {
    const line = lines[at] ?? "";
    if (line.startsWith("!") || /^[^\s:]+\.tex:\d+: /.test(line)) {
      found.push(line.trim());
      const where = (lines[at + 1] ?? "").trim();
      if (/^l\.\d+/.test(where)) {
        found.push(where);
      }
    }
  }
  return found.length > 0 ? found.join("\n") : lines.slice(-8).join("\n").trim();
}

/** The LaTeX programs a note may ask for. A note names a program, and never the place of one. */
export const PROGRAMS = ["pdflatex", "xelatex", "lualatex"] as const;
export type Program = (typeof PROGRAMS)[number];

/**
 * The program a document asks for in a comment among its first lines, as
 * editors of LaTeX read it: `% !TEX program = xelatex`. Null when it asks
 * for none, or for one that is not known here.
 */
export function programOf(latex: string): Program | null {
  for (const line of latex.split("\n", 12)) {
    const asked = /^%\s*!TEX\s+(?:TS-)?program\s*=\s*(\S+)\s*$/i.exec(line.trim());
    if (asked !== null) {
      const name = (asked[1] ?? "").toLowerCase();
      return PROGRAMS.find((program) => program === name) ?? null;
    }
  }
  return null;
}

/** True when the LaTeX program says that it has to run once more, as for the outline of a PDF */
export function wantsAnotherRun(log: string): boolean {
  return /Rerun to get|Rerun LaTeX|rerunfilecheck.*has changed/i.test(log);
}
