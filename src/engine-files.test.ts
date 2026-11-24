import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { gzipSync } from "node:zlib";
import { fetchedEngine, inlinedEngine } from "./engine-files.ts";
import type { Fetch } from "./engine.ts";
import { sha256Of, type Pins } from "./pins.ts";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const script = bytes("// the script of the engine");
const wasm = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0xff, 0x80]);

const pins: Pins = {
  script: { name: "engine.js", url: "https://example.org/pinned/engine.js", sha256: sha256Of(script), bytes: script.byteLength },
  wasm: { name: "engine.wasm", url: "https://example.org/pinned/engine.wasm", sha256: sha256Of(wasm), bytes: wasm.byteLength },
};

/** A host that has the files that are given, and writes down what it was asked for */
const host = (files: Record<string, Uint8Array>): { fetch: Fetch; asked: string[] } => {
  const asked: string[] = [];
  return {
    asked,
    fetch: (url) => {
      asked.push(url);
      const body = files[url];
      return Promise.resolve(body === undefined ? { status: 404, headers: {}, body: new Uint8Array() } : { status: 200, headers: {}, body });
    },
  };
};

const noNetwork: Fetch = (url) => Promise.reject(new Error(`asked for ${url}`));

async function inFolder(test: (folder: string) => Promise<void>): Promise<void> {
  const folder = await mkdtemp(join(tmpdir(), "latex-to-pdf-test-"));
  try {
    await test(folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

describe("fetchedEngine", () => {
  it("fetches the files where they are published, and keeps them", async () => {
    await inFolder(async (folder) => {
      const { fetch, asked } = host({ [pins.script.url]: script, [pins.wasm.url]: wasm });
      const files = await fetchedEngine(join(folder, "engine"), pins)(fetch);
      assert.deepEqual(files, { script, wasm });
      assert.deepEqual(asked, [pins.script.url, pins.wasm.url]);
      assert.deepEqual((await readdir(join(folder, "engine"))).sort(), ["engine.js", "engine.wasm"]);
      assert.deepEqual(new Uint8Array(await readFile(join(folder, "engine", "engine.wasm"))), wasm);
    });
  });

  it("takes them from the folder afterwards, with no network", async () => {
    await inFolder(async (folder) => {
      await fetchedEngine(folder, pins)(host({ [pins.script.url]: script, [pins.wasm.url]: wasm }).fetch);
      assert.deepEqual(await fetchedEngine(folder, pins)(noNetwork), { script, wasm });
    });
  });

  it("refuses a file that is not the one pinned, and keeps nothing of it", async () => {
    await inFolder(async (folder) => {
      const { fetch } = host({ [pins.script.url]: script, [pins.wasm.url]: bytes("another program") });
      await assert.rejects(fetchedEngine(folder, pins)(fetch), /"engine\.wasm" is not the file this plugin was made for, and is refused/);
      assert.deepEqual(await readdir(folder), ["engine.js"]);
    });
  });

  it("does not use a kept file that was changed: it fetches the file anew", async () => {
    await inFolder(async (folder) => {
      const { fetch, asked } = host({ [pins.script.url]: script, [pins.wasm.url]: wasm });
      await fetchedEngine(folder, pins)(fetch);
      await writeFile(join(folder, "engine.wasm"), bytes("changed"));
      await assert.rejects(fetchedEngine(folder, pins)(noNetwork), /could not be fetched from https:\/\/example\.org\/pinned\/engine\.wasm: asked for /);
      asked.length = 0;
      assert.deepEqual(await fetchedEngine(folder, pins)(fetch), { script, wasm });
      assert.deepEqual(asked, [pins.wasm.url]);
      assert.deepEqual(new Uint8Array(await readFile(join(folder, "engine.wasm"))), wasm);
    });
  });

  it("says so when the files cannot be had", async () => {
    await inFolder(async (folder) => {
      await assert.rejects(fetchedEngine(folder, pins)(host({}).fetch), /could not be fetched: https:\/\/example\.org\/pinned\/engine\.js answered 404/);
    });
  });
});

describe("inlinedEngine", () => {
  const pack = (data: Uint8Array): string => gzipSync(data).toString("base64");

  it("unpacks the engine the build put in, and fetches nothing", async () => {
    assert.deepEqual(await inlinedEngine({ script: pack(script), wasm: pack(wasm) }, pins)(noNetwork), { script, wasm });
  });

  it("refuses an engine that is not the one pinned", () => {
    assert.throws(() => void inlinedEngine({ script: pack(script), wasm: pack(bytes("another program")) }, pins)(noNetwork), /"engine\.wasm" is not the file this plugin was made for/);
  });
});
