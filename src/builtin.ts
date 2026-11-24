/**
 * Runs the built-in engine: the pdfTeX of the SwiftLaTeX project, as
 * WebAssembly, in a worker of the page. It is for a computer that has no
 * LaTeX program.
 *
 * Nothing of that project is copied here. The engine is run as it is
 * published, and told what to do with the messages its script answers to.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MOST_RUNS, type Compiled } from "./compile.ts";
import type { EngineSource } from "./engine-files.ts";
import { passes, withLetters, type Fetch, type Pass } from "./engine.ts";
import { ENGINE } from "./pins.ts";
import { serveTexFiles, type TexFiles } from "./tex-files.ts";

/** What the built-in engine needs of the plugin */
export interface BuiltIn {
  /** Where the files of the engine come from: see `engine-files.ts` */
  engine: EngineSource;
  /** The folder where what was fetched is kept */
  cache: string;
  fetch: Fetch;
}

/**
 * What the worker runs: it loads the script of the engine from the address
 * it is named after, and the engine then runs unchanged.
 *
 * - Obsidian gives a worker Node.js. The script of the engine would take
 *   itself to be run by Node.js, and look for its .wasm among the files of
 *   the computer: without `process` it fetches the .wasm, as on the web.
 * - A worker that is made of text has no address of its own, so the name of
 *   the .wasm alone leads nowhere: it is asked for where the script came from.
 */
const WORKER = `self.process = undefined;
const from = self.name;
const plain = self.fetch;
self.fetch = (what, how) => plain(what === ${JSON.stringify(ENGINE.wasm.name)} ? from + what : what, how);
importScripts(from + ${JSON.stringify(ENGINE.script.name)});
`;

/** What the script of the engine says: that it is ready, and what came of a run */
interface Said {
  cmd?: string;
  result?: string;
  log?: string;
  pdf?: ArrayBuffer;
}

/**
 * The next thing the engine says that is looked for.
 *
 * @param seconds how long the engine may be still: it is not still while it is handed a file
 * @throws when the engine stops, or is still for too long
 */
function next(worker: Worker, tex: TexFiles, seconds: number, wanted: (said: Said) => boolean): Promise<Said> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const end = (): void => {
      window.clearInterval(watch);
      worker.onmessage = null;
      worker.onerror = null;
    };
    const watch = window.setInterval(() => {
      if (Date.now() - Math.max(started, tex.busy) > seconds * 1000) {
        end();
        reject(new Error(`! The built-in engine took longer than ${String(seconds)} seconds.`));
      }
    }, 1000);
    worker.onmessage = (event: MessageEvent<Said>) => {
      if (wanted(event.data)) {
        end();
        resolve(event.data);
      }
    };
    worker.onerror = (event) => {
      end();
      reject(new Error(`The built-in engine stopped: ${event.message}`));
    };
  });
}

/**
 * Builds a LaTeX document into a PDF with the built-in engine.
 *
 * The engine runs in a worker that is gone afterwards, and writes into
 * memory only: nothing but the PDF comes to the vault. A document cannot
 * start programs of the computer, and an error ends the run: the engine is
 * made that way.
 *
 * @param inputs the folder of the note, where files the document takes in by name are looked for
 * @param seconds how long the engine may be still in one run
 * @returns the PDF, and how many bytes were fetched for it
 * @throws with the errors of the document, as the engine wrote them
 */
export async function compileBuiltIn(latex: string, inputs: string, { engine, cache, fetch }: BuiltIn, seconds = 120): Promise<Compiled & { fetched: number }> {
  let fetched = 0;
  const counted: Fetch = async (url) => {
    const got = await fetch(url);
    fetched += got.body.byteLength;
    return got;
  };
  // What is kept can be fetched again: a vault in version control is told to pass over it
  await mkdir(cache, { recursive: true });
  await writeFile(join(cache, ".gitignore"), "*\n", { flag: "wx" }).catch(() => undefined);

  const tex = await serveTexFiles(await engine(counted), cache, inputs, counted);
  const page = URL.createObjectURL(new Blob([WORKER], { type: "text/javascript" }));
  const worker = new Worker(page, { name: tex.url });
  try {
    const ready = await next(worker, tex, seconds, (said) => said.result !== undefined);
    if (ready.result !== "ok") {
      throw new Error(`The built-in engine did not start. ${ready.log ?? ""}`.trim());
    }
    worker.postMessage({ cmd: "settexliveurl", url: tex.url });
    worker.postMessage({ cmd: "writefile", url: "main.tex", src: withLetters(latex) });
    const run = async (): Promise<Pass> => {
      const done = next(worker, tex, seconds, (said) => said.cmd === "compile");
      worker.postMessage({ cmd: "compilelatex" });
      const said = await done;
      return { pdf: said.result === "ok" && said.pdf !== undefined ? new Uint8Array(said.pdf) : null, log: said.log ?? "" };
    };
    const made = await passes(run, MOST_RUNS).catch((error: unknown) => {
      // A document that fails for a file that could not be fetched: the reason is the network, and not the document
      throw tex.trouble === null ? error : new Error(tex.trouble);
    });
    if (tex.trouble !== null) {
      // The document went on without the file, as without a file that TeX may do without: its PDF is not the one it should be
      throw new Error(tex.trouble);
    }
    return { ...made, fetched };
  } finally {
    worker.terminate();
    URL.revokeObjectURL(page);
    await tex.close();
  }
}
