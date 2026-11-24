/** Choosing the engine of a build, and what the built-in engine asks for and how often it runs. Nothing here touches a file, so it is tested with plain Node.js. */

import type { Compiled } from "./compile.ts";
import { errorOf, wantsAnotherRun } from "./latex.ts";
import { pagesOf, samePdf } from "./pdf.ts";

/** What the settings may say: `auto` takes the installed program when there is one, and the built-in engine when there is none */
export const ENGINES = ["auto", "installed", "built-in"] as const;
export type EngineChoice = (typeof ENGINES)[number];

/** What built a PDF: the LaTeX program of the computer, or the pdfTeX that comes with the plugin */
export type Engine = "installed" | "built-in";

/** What the settings say, read from what was saved: `auto` for anything that is not a choice */
export function engineChoiceOf(saved: unknown): EngineChoice {
  return ENGINES.find((one) => one === saved) ?? "auto";
}

/** True for `pdflatex`, by its name or by the path of its file: the one program the built-in engine can stand in for */
function isPdflatex(program: string): boolean {
  return /(^|[\\/])pdflatex(\.exe)?$/i.test(program.trim());
}

/**
 * The engine that builds a document.
 *
 * @param program what the document or the settings ask for: a name, or the path of a file
 * @param found the file of that program on this computer, or null when it has none: see `findProgram`
 * @throws with what to do, when nothing here can build the document
 */
export function engineFor(choice: EngineChoice, program: string, found: string | null): Engine {
  if (choice !== "built-in" && found !== null) {
    return "installed";
  }
  if (choice === "installed") {
    throw new Error(`The LaTeX program "${program}" is not on this computer. Install TeX Live or MacTeX, or name the file of the program in the settings.`);
  }
  if (!isPdflatex(program)) {
    throw new Error(
      choice === "built-in"
        ? `The built-in engine is pdfTeX only: it cannot build a document that asks for "${program}". Choose the installed program in the settings, or build the document with pdflatex.`
        : `The LaTeX program "${program}" is not on this computer, and the built-in engine is pdfTeX only: it cannot stand in for "${program}". Install TeX Live or MacTeX, or build the document with pdflatex.`,
    );
  }
  return "built-in";
}

/** What a request gave: the built-in engine and its files are fetched through this, so that a test needs no network */
export interface Fetched {
  status: number;
  /** With the names in small letters */
  headers: Record<string, string>;
  body: Uint8Array;
}
export type Fetch = (url: string) => Promise<Fetched>;

/** A file the built-in engine asks for by name */
export interface Asked {
  /**
   * What is asked of the host after `pdftex/`, and where the answer is kept
   * in the cache: `26/article.cls`, where 26 is the kind of file as TeX
   * numbers them, or `pk/600/cmr10` for a font drawn at 600 dots an inch.
   */
  key: string;
  name: string;
}

/**
 * What the engine asks for, from the path of its request, or null when the
 * path is none the engine makes. A name never holds a folder: nothing above
 * the folder it is looked for in can be reached.
 */
export function askedOf(path: string): Asked | null {
  const parts = /^pdftex\/(\d{1,3}|pk\/\d{1,5})\/([^/]+)$/.exec(path);
  if (parts === null) {
    return null;
  }
  let name: string;
  try {
    name = decodeURIComponent(parts[2] ?? "");
  } catch {
    return null;
  }
  if (name.length > 200 || name.startsWith(".") || /[\\/:]|\p{Cc}/u.test(name)) {
    return null;
  }
  return { key: `${parts[1] ?? ""}/${name}`, name };
}

/** The ending TeX gives a name that has none, by the kind of file as TeX numbers them: for the kinds a document has files of its own of */
const ENDINGS: Record<string, string> = { "26": ".tex", "6": ".bib", "7": ".bst" };

/**
 * The names under which a file that is asked for is looked for beside the
 * note. A name with no ending is tried with the ending of its kind first, as
 * TeX does it: `\input{part}` asks for `part`, and means `part.tex`.
 */
export function namesBeside(asked: Asked): string[] {
  const ending = ENDINGS[asked.key.slice(0, asked.key.indexOf("/"))];
  return ending === undefined || asked.name.includes(".") ? [asked.name] : [asked.name + ending, asked.name];
}

/**
 * True for a name as the files of TeX have them: `article.cls`, `cmr10`,
 * `l3backend-pdfmode.def`. A name of another make is looked for beside the
 * note only: it is not asked of the host, and makes no file in the cache.
 */
export function isTexName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(name);
}

/**
 * A document as the built-in engine is given it: told to write into the PDF
 * which letters its signs stand for.
 *
 * A LaTeX of today does this by itself. The LaTeX of the built-in engine is
 * older and does not, and its PDF would look the same and read otherwise:
 * "fi" set as one sign would be taken out as that sign, not as two letters,
 * by whatever reads the PDF by program, as a search or the software an
 * application for a job goes through.
 *
 * Put before the first line and not above it, so that the lines of the
 * document keep their numbers in what LaTeX says of an error.
 */
export function withLetters(latex: string): string {
  return "\\pdfgentounicode=1 \\input{glyphtounicode}" + latex;
}

/**
 * True for a file the run itself writes, as `main.aux` and `main.out`. On
 * the first run they are not there yet, and the engine asks for them as for
 * any file: the host is not asked, it cannot have them.
 */
export function isOfTheRun(name: string): boolean {
  return name.startsWith("main.");
}

/** Where the files of TeX are kept, from the cache folder */
export const TEX_CACHE = "tex";

/** The list of what is kept: for each key the name the engine saves the file under, or null for a file the host does not have */
export const TEX_INDEX = `${TEX_CACHE}/index.json`;

/** Where the answer of the host is kept, from the cache folder: `tex/26/article.cls` */
export function cachePathOf(asked: Asked): string {
  return `${TEX_CACHE}/${asked.key}`;
}

/** What one run of the built-in engine gave: no PDF when the document has an error */
export interface Pass {
  pdf: Uint8Array | null;
  log: string;
}

/**
 * Runs the built-in engine until the document has settled, as the installed
 * program is run: the numbers of pages and sections, and the outline of the
 * PDF, are right only then.
 *
 * It runs again while the log asks for it, or while the PDF still comes out
 * different from the run before but for its times. The engine keeps what one
 * run leaves for the next to itself, so the PDF is what tells.
 *
 * @param most how often it runs at most
 * @throws with the errors of the document, as the engine wrote them
 */
export async function passes(run: () => Promise<Pass>, most: number): Promise<Compiled> {
  let before: Uint8Array | null = null;
  for (let runs = 1; ; runs++) {
    const { pdf, log } = await run();
    if (pdf === null) {
      throw new Error(errorOf(log) || "The built-in engine ended with an error.");
    }
    if (runs >= most || (before !== null && samePdf(before, pdf) && !wantsAnotherRun(log))) {
      return { pdf, pages: pagesOf(log), runs };
    }
    before = pdf;
  }
}
