/**
 * Where the bytes of the built-in engine come from. This is the one place
 * that knows: the rest of the plugin asks an `EngineSource` and does not
 * care which of the two ways it is. Either way, a file that is not the one
 * pinned in `pins.ts` is refused.
 */

import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { Fetch } from "./engine.ts";
import { checked, ENGINE, type Pinned, type Pins } from "./pins.ts";

/** The engine, ready to run */
export interface EngineFiles {
  script: Uint8Array;
  wasm: Uint8Array;
}

/**
 * Gives the files of the engine.
 *
 * @param fetch asked only by a source that has to fetch
 */
export type EngineSource = (fetch: Fetch) => Promise<EngineFiles>;

/** The engine as the build puts it into `main.js`: each file gzipped, as base64. See `esbuild.config.mjs`. */
export interface Packed {
  script: string;
  wasm: string;
}

/**
 * The engine that is inside the plugin: `npm run build:engine` put it into
 * `main.js`. Nothing is fetched. This is the way for a release.
 */
export function inlinedEngine(packed: Packed, pins: Pins = ENGINE): EngineSource {
  let files: EngineFiles | null = null;
  return () => {
    files ??= {
      script: checked(pins.script, new Uint8Array(gunzipSync(Buffer.from(packed.script, "base64")))),
      wasm: checked(pins.wasm, new Uint8Array(gunzipSync(Buffer.from(packed.wasm, "base64")))),
    };
    return Promise.resolve(files);
  };
}

/**
 * Keeps a file, in a folder that is made when it is not there. The file is
 * written beside its place and then moved there, so it is there whole or not
 * at all, also when two builds keep the same file at once.
 */
export async function keep(path: string, data: Uint8Array | string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const part = `${path}.${randomBytes(4).toString("hex")}.part`;
  await writeFile(part, data);
  await rename(part, path);
}

async function kept(folder: string, file: Pinned, fetch: Fetch): Promise<Uint8Array> {
  const path = join(folder, file.name);
  const there = await readFile(path).catch(() => null);
  if (there !== null) {
    try {
      return checked(file, new Uint8Array(there));
    } catch {
      // What is kept is not the file any more: it is not used, and the file is fetched anew
    }
  }
  const got = await fetch(file.url).catch((error: unknown) => {
    throw new Error(`The built-in engine could not be fetched from ${file.url}: ${error instanceof Error ? error.message : String(error)}`);
  });
  if (got.status !== 200) {
    throw new Error(`The built-in engine could not be fetched: ${file.url} answered ${String(got.status)}.`);
  }
  const bytes = checked(file, got.body);
  await keep(path, bytes);
  return bytes;
}

/**
 * FOR DEVELOPMENT ONLY, NOT FOR A RELEASE: the engine is fetched the first
 * time it is needed, from where its project publishes it, and kept in a
 * folder. `npm run build`, which leaves the engine out of `main.js`, makes a
 * plugin that works this way.
 *
 * A plugin in the community directory of Obsidian may not fetch its own
 * parts when it runs ("Install or update themselves or their dependencies",
 * Developer policies). A release is built with `npm run build:engine`, and
 * uses `inlinedEngine`.
 *
 * @param folder where the files are kept
 */
export function fetchedEngine(folder: string, pins: Pins = ENGINE): EngineSource {
  return async (fetch) => ({
    script: await kept(folder, pins.script, fetch),
    wasm: await kept(folder, pins.wasm, fetch),
  });
}
