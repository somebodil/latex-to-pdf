import { builtinModules } from "node:module";
import esbuild from "esbuild";

// `node esbuild.config.mjs production` builds once. Without the argument it rebuilds on every change.
const production = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  outfile: "main.js",
  bundle: true,
  format: "cjs",
  target: "es2020",
  // Obsidian provides these at run time, and the parts of Node.js that the desktop app has
  external: ["obsidian", "electron", ...builtinModules, ...builtinModules.map((name) => `node:${name}`)],
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
