import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { gzipSync } from "node:zlib";
import { inlinedEngine } from "./engine-files.ts";
import { sha256Of, type Pins } from "./pins.ts";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const script = bytes("// the script of the engine");
const wasm = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0xff, 0x80]);

const pins: Pins = {
  script: { name: "engine.js", url: "https://example.org/pinned/engine.js", sha256: sha256Of(script), bytes: script.byteLength },
  wasm: { name: "engine.wasm", url: "https://example.org/pinned/engine.wasm", sha256: sha256Of(wasm), bytes: wasm.byteLength },
};

describe("inlinedEngine", () => {
  const pack = (data: Uint8Array): string => gzipSync(data).toString("base64");

  it("unpacks the engine the build put in", async () => {
    assert.deepEqual(await inlinedEngine({ script: pack(script), wasm: pack(wasm) }, pins)(), { script, wasm });
  });

  it("refuses an engine that is not the one pinned", () => {
    assert.throws(() => void inlinedEngine({ script: pack(script), wasm: pack(bytes("another program")) }, pins)(), /"engine\.wasm" is not the file this plugin was made for/);
  });
});
