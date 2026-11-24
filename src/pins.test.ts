import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checked, ENGINE, sha256Of, TEX_HOST, type Pinned } from "./pins.ts";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("checked", () => {
  const file: Pinned = { name: "engine.wasm", url: "https://example.org/engine.wasm", sha256: sha256Of(bytes("the engine")), bytes: 10 };

  it("gives back the bytes of the file that is pinned", () => {
    assert.deepEqual(checked(file, bytes("the engine")), bytes("the engine"));
  });

  it("refuses a file that is anything else, and says which one", () => {
    assert.throws(() => checked(file, bytes("the engine.")), /"engine\.wasm" is not the file this plugin was made for, and is refused/);
    assert.throws(() => checked(file, new Uint8Array()), /is refused/);
  });

  it("knows the SHA-256 of bytes", () => {
    assert.equal(sha256Of(bytes("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("the pins", () => {
  it("name each file of the engine by a commit, and never by a branch or the latest", () => {
    for (const file of [ENGINE.script, ENGINE.wasm]) {
      assert.match(file.url, /^https:\/\/raw\.githubusercontent\.com\/SwiftLaTeX\/SwiftLaTeX\/[0-9a-f]{40}\/[a-z]+\.(js|wasm)$/);
      assert.equal(file.url.endsWith(`/${file.name}`), true);
      assert.match(file.sha256, /^[0-9a-f]{64}$/);
    }
  });

  it("name one host for the files of TeX, asked over https", () => {
    assert.match(TEX_HOST, /^https:\/\/[a-z0-9.-]+\/$/);
  });
});
