/** What the build puts in for this name: the built-in engine. See `esbuild.config.mjs`. */
declare module "inlined-engine" {
  const packed: import("./engine-files.ts").Packed;
  export default packed;
}
