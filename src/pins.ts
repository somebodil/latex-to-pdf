/** The built-in engine: where its files are published, what they have to be, and where it asks for the files of TeX. The build reads this as well. */

import { createHash } from "node:crypto";

/** A file as its project publishes it */
export interface Pinned {
  name: string;
  url: string;
  /** The SHA-256 of the file, in hex. A file that is anything else is refused. */
  sha256: string;
  bytes: number;
}

/** The two files of the engine: the script that runs it in a worker, and the program itself */
export interface Pins {
  script: Pinned;
  wasm: Pinned;
}

/**
 * The files the site of the SwiftLaTeX project serves (swiftlatex.com), named
 * by the commit that holds them: the address of a commit gives the same
 * bytes for good, and never "the latest".
 */
const PUBLISHED = "https://raw.githubusercontent.com/SwiftLaTeX/SwiftLaTeX/de27ed3b31a2735ea749eb523a6786578cbf4c24/";

/**
 * pdfTeX 1.40.21 as WebAssembly, from https://github.com/SwiftLaTeX/SwiftLaTeX.
 *
 * These files are not part of this repository, and they have a licence of
 * their own: the repository of SwiftLaTeX is under AGPL-3.0, and pdfTeX,
 * which the .wasm is made of, under GPL-2.0-or-later.
 */
export const ENGINE: Pins = {
  script: {
    name: "swiftlatexpdftex.js",
    url: `${PUBLISHED}swiftlatexpdftex.js`,
    sha256: "44d7dd9bc63b826985c87b8ada50512b8fae02cbf5eb3c57e258129ed9602536",
    bytes: 85387,
  },
  wasm: {
    name: "swiftlatexpdftex.wasm",
    url: `${PUBLISHED}swiftlatexpdftex.wasm`,
    sha256: "a2847460f4c55e623e2ccd4898ee629596a1ce121395eeda1cfbdf7a94893c62",
    bytes: 1772266,
  },
};

/**
 * Where the engine asks for the files of TeX by name: classes, packages,
 * fonts and the format. The endpoint of SwiftLaTeX itself
 * (texlive2.swiftlatex.com) does not answer any more. This one is kept by
 * the TeXlyre project, speaks the same protocol, and holds the format that
 * goes with the engine above.
 */
export const TEX_HOST = "https://texlive.texlyre.org/";

export function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The bytes, when they are the file that is pinned.
 *
 * @throws when they are anything else: such a file is refused, wherever it came from
 */
export function checked(file: Pinned, bytes: Uint8Array): Uint8Array {
  const found = sha256Of(bytes);
  if (found !== file.sha256) {
    throw new Error(`"${file.name}" is not the file this plugin was made for, and is refused: its SHA-256 is ${found}, in place of ${file.sha256}.`);
  }
  return bytes;
}
