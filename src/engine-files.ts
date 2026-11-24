/**
 * The bytes of the built-in engine: they are inside the plugin, put there
 * by the build. A file that is not the one pinned in `pins.ts` is refused.
 *
 * The plugin never fetches the engine when it runs: a plugin in the
 * community directory of Obsidian may not fetch its own parts.
 */

import { randomBytes } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { gunzipSync } from "node:zlib";
import { checked, ENGINE, type Pins } from "./pins.ts";

/** The engine, ready to run */
export interface EngineFiles {
  script: Uint8Array;
  wasm: Uint8Array;
}

/** The engine as the build puts it into `main.js`: each file gzipped, as base64. See `esbuild.config.mjs`. */
export interface Packed {
  script: string;
  wasm: string;
}

/** Unpacks the engine that is inside the plugin: the build put it into `main.js`. Nothing is fetched. */
export function inlinedEngine(packed: Packed, pins: Pins = ENGINE): EngineFiles {
  return {
    script: checked(pins.script, new Uint8Array(gunzipSync(Buffer.from(packed.script, "base64")))),
    wasm: checked(pins.wasm, new Uint8Array(gunzipSync(Buffer.from(packed.wasm, "base64")))),
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
