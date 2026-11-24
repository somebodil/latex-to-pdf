import { mkdir, readFile, writeFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { gzipSync } from "node:zlib";
import esbuild from "esbuild";
import { checked, ENGINE } from "./src/pins.ts";

// `node esbuild.config.mjs production` builds once. Without the argument it rebuilds on every change.
// Either way the built-in engine is put into main.js: see `inlinedEngine` below.
const production = process.argv.includes("production");

/** Where the files of the engine are kept between builds. Git passes over this folder: the files are not part of this repository. */
const ENGINE_FOLDER = ".engine";

/** A file of the engine, from the folder or from where it is published: either way it has to be the file that is pinned in src/pins.ts */
async function engineFile(file) {
  const path = `${ENGINE_FOLDER}/${file.name}`;
  try {
    return checked(file, await readFile(path));
  } catch {
    const got = await fetch(file.url);
    if (!got.ok) {
      throw new Error(`${file.url} answered ${got.status}`);
    }
    const bytes = checked(file, new Uint8Array(await got.arrayBuffer()));
    await mkdir(ENGINE_FOLDER, { recursive: true });
    await writeFile(path, bytes);
    return bytes;
  }
}

/**
 * Gives the source its `inlined-engine`: the engine, each file gzipped and
 * as base64. The plugin then holds its engine, and fetches no part of
 * itself when it runs.
 */
const inlinedEngine = {
  name: "inlined-engine",
  setup(build) {
    build.onResolve({ filter: /^inlined-engine$/ }, () => ({ path: "inlined-engine", namespace: "inlined-engine" }));
    build.onLoad({ filter: /.*/, namespace: "inlined-engine" }, async () => {
      const pack = async (file) => gzipSync(await engineFile(file), { level: 9 }).toString("base64");
      const packed = { script: await pack(ENGINE.script), wasm: await pack(ENGINE.wasm) };
      return { contents: `export default ${JSON.stringify(packed)};`, loader: "js" };
    });
  },
};

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  outfile: "main.js",
  bundle: true,
  format: "cjs",
  target: "es2020",
  // Obsidian provides these at run time, and the parts of Node.js that the desktop app has
  external: ["obsidian", "electron", ...builtinModules, ...builtinModules.map((name) => `node:${name}`)],
  plugins: [inlinedEngine],
  minify: production,
  sourcemap: production ? false : "inline",
  logLevel: "info",
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
