/**
 * What the build puts in for this name: the built-in engine, with
 * `npm run build:engine`, or null, with `npm run build`. See `esbuild.config.mjs`.
 */
declare module "inlined-engine" {
  const packed: import("./engine-files.ts").Packed | null;
  export default packed;
}
