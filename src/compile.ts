/** Runs the LaTeX program of the computer. This is the part that needs a desktop: it starts a program and writes into a folder of its own. */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { errorOf, wantsAnotherRun } from "./latex.ts";
import { pagesOf } from "./pdf.ts";

/** Where a LaTeX program is installed, besides what the path of the computer names: an app that is started from the dock is not told the path a terminal has */
const MORE_PLACES = ["/Library/TeX/texbin", "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/opt/local/bin"];

/** A document is run again while its numbers and outline still change, at most this often */
export const MOST_RUNS = 4;

/** What a run leaves for the next: where the labels are, the outline, the contents */
const CARRIED = ["main.aux", "main.out", "main.toc"];

export interface Compiled {
  pdf: Uint8Array;
  /** Null when the program did not say */
  pages: number | null;
  /** How often the program ran */
  runs: number;
}

/**
 * The file of a LaTeX program, or null when the computer has none of that
 * name. A name with a folder in it is taken as it is.
 */
export function findProgram(name: string): string | null {
  const isWindows = process.platform === "win32";
  const names = isWindows && !/\.exe$/i.test(name) ? [`${name}.exe`, name] : [name];
  if (isAbsolute(name) || /[\\/]/.test(name)) {
    return names.find((one) => existsSync(one)) ?? null;
  }
  const places = [...(process.env.PATH ?? "").split(delimiter).filter((place) => place !== ""), ...(isWindows ? [] : MORE_PLACES)];
  for (const place of places) {
    for (const one of names) {
      const file = join(place, one);
      if (existsSync(file)) {
        return file;
      }
    }
  }
  return null;
}

function runOnce(program: string, folder: string, inputs: string, seconds: number): Promise<{ ok: boolean; said: string }> {
  return new Promise((resolve) => {
    execFile(
      program,
      // A document is not let run programs of the computer, and an error ends the run in place of asking what to do
      ["-interaction=nonstopmode", "-halt-on-error", "-no-shell-escape", "-file-line-error", "main.tex"],
      {
        cwd: folder,
        timeout: seconds * 1000,
        maxBuffer: 64 * 1024 * 1024,
        // The folder of the note comes after the folder of the run, and the places of LaTeX itself after both
        env: { ...process.env, TEXINPUTS: `.${delimiter}${inputs}${delimiter}${process.env.TEXINPUTS ?? ""}` },
      },
      (error, stdout) => {
        const timedOut = error !== null && (error as { killed?: boolean }).killed === true;
        resolve({ ok: error === null, said: timedOut ? `${stdout}\n! The LaTeX program took longer than ${String(seconds)} seconds.` : stdout });
      },
    );
  });
}

/** What a run left for the next, file by file: a file that is not there is an empty one */
function carried(folder: string): Promise<Buffer[]> {
  return Promise.all(CARRIED.map((name) => readFile(join(folder, name)).catch(() => Buffer.alloc(0))));
}

/**
 * Builds a LaTeX document into a PDF.
 *
 * The program runs in a folder of its own, which is gone afterwards, so
 * nothing but the PDF comes to the vault. It runs again while what one run
 * leaves for the next still changes: the numbers of pages and sections, and
 * the outline of the PDF, are right only then.
 *
 * @param program the file of the LaTeX program: see `findProgram`
 * @param inputs the folder of the note, where files the document takes in by name are looked for
 * @param seconds how long one run may take
 * @throws with the errors of the document, as the program wrote them
 */
export async function compile(latex: string, program: string, inputs: string, seconds = 120): Promise<Compiled> {
  const folder = await mkdtemp(join(tmpdir(), "latex-to-pdf-"));
  try {
    await writeFile(join(folder, "main.tex"), latex);
    let before = await carried(folder);
    for (let runs = 1; ; runs++) {
      const { ok, said } = await runOnce(program, folder, inputs, seconds);
      if (!ok) {
        const log = await readFile(join(folder, "main.log"), "utf8").catch(() => "");
        throw new Error(errorOf(said.trim() !== "" ? said : log) || "The LaTeX program ended with an error.");
      }
      const after = await carried(folder);
      if (runs >= MOST_RUNS || (after.every((file, at) => file.equals(before[at] ?? Buffer.alloc(1))) && !wantsAnotherRun(said))) {
        return { pdf: new Uint8Array(await readFile(join(folder, "main.pdf"))), pages: pagesOf(said), runs };
      }
      before = after;
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
