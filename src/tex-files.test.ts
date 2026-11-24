import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { Fetch, Fetched } from "./engine.ts";
import { ENGINE } from "./pins.ts";
import { serveTexFiles, type TexFiles } from "./tex-files.ts";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const engine = { script: bytes("// the script"), wasm: new Uint8Array([0, 97, 115, 109]) };
const HOST = "https://tex.example.org/";

/** A host that has the files that are given, by what is asked after `pdftex/`, and writes down what it was asked for */
const host = (files: Record<string, { id: string; body: string }>): { fetch: Fetch; asked: string[] } => {
  const asked: string[] = [];
  return {
    asked,
    fetch: (url) => {
      asked.push(url);
      const file = files[url.slice(`${HOST}pdftex/`.length)];
      const got: Fetched = file === undefined ? { status: 301, headers: {}, body: bytes("File not found") } : { status: 200, headers: { fileid: file.id }, body: bytes(file.body) };
      return Promise.resolve(got);
    },
  };
};

const noNetwork: Fetch = (url) => Promise.reject(new Error(`no network for ${url}`));

/** What an address on this computer answers */
function ask(url: string, method = "GET"): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }> {
  return new Promise((resolve, reject) => {
    request(url, { method }, (answer) => {
      const parts: Buffer[] = [];
      answer.on("data", (part: Buffer) => parts.push(part));
      answer.on("end", () => resolve({ status: answer.statusCode ?? 0, headers: answer.headers, body: Buffer.concat(parts) }));
    })
      .on("error", reject)
      .end();
  });
}

/** What the engine gets for a path: the status, the name to save the file under, and the file */
async function get(files: TexFiles, path: string): Promise<{ status: number; id: string | null; body: string }> {
  const got = await ask(files.url + path);
  return { status: got.status, id: typeof got.headers.fileid === "string" ? got.headers.fileid : null, body: got.body.toString("utf8") };
}

/** Runs a test with a cache folder and the folder of a note, and with what hands out the files */
async function serving(fetch: Fetch, test: (files: TexFiles, cache: string, inputs: string) => Promise<void>, folder?: string): Promise<void> {
  const root = folder ?? (await mkdtemp(join(tmpdir(), "latex-to-pdf-test-")));
  const cache = join(root, "engine");
  const inputs = join(root, "notes");
  await mkdir(inputs, { recursive: true });
  const files = await serveTexFiles(engine, cache, inputs, fetch, HOST);
  try {
    await test(files, cache, inputs);
  } finally {
    await files.close();
    if (folder === undefined) {
      await rm(root, { recursive: true, force: true });
    }
  }
}

describe("serveTexFiles", () => {
  it("hands the engine its own files, as a script and as WebAssembly", async () => {
    await serving(noNetwork, async (files) => {
      const script = await ask(files.url + ENGINE.script.name);
      assert.equal(script.headers["content-type"], "text/javascript");
      assert.equal(script.headers["access-control-allow-origin"], "*");
      assert.equal(script.body.toString("utf8"), "// the script");
      const wasm = await ask(files.url + ENGINE.wasm.name);
      assert.equal(wasm.headers["content-type"], "application/wasm");
      assert.deepEqual(new Uint8Array(wasm.body), engine.wasm);
    });
  });

  it("listens on this computer only, and answers nothing without the word of the build", async () => {
    await serving(noNetwork, async (files) => {
      assert.match(files.url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/$/);
      const origin = new URL(files.url).origin;
      assert.equal((await ask(`${origin}/${ENGINE.script.name}`)).status, 404);
      assert.equal((await ask(`${origin}/${"0".repeat(32)}/${ENGINE.script.name}`)).status, 404);
      assert.equal((await ask(files.url + ENGINE.script.name, "POST")).status, 404);
    });
  });

  it("asks the host for a file of TeX, and says under which name to save it", async () => {
    const { fetch, asked } = host({ "26/article.cls": { id: "article.cls", body: "the class" }, "3/cmr10": { id: "cmr10.tfm", body: "the font" } });
    await serving(fetch, async (files, cache) => {
      assert.deepEqual(await get(files, "pdftex/26/article.cls"), { status: 200, id: "article.cls", body: "the class" });
      assert.deepEqual(await get(files, "pdftex/3/cmr10"), { status: 200, id: "cmr10.tfm", body: "the font" });
      assert.deepEqual(asked, [`${HOST}pdftex/26/article.cls`, `${HOST}pdftex/3/cmr10`]);
      assert.equal(await readFile(join(cache, "tex", "26", "article.cls"), "utf8"), "the class");
      assert.equal(files.trouble, null);
    });
  });

  it("keeps what the host said, also that it has no such file: a second build needs no network", async () => {
    const root = await mkdtemp(join(tmpdir(), "latex-to-pdf-test-"));
    try {
      const { fetch, asked } = host({ "26/article.cls": { id: "article.cls", body: "the class" }, "3/cmr10": { id: "cmr10.tfm", body: "the font" } });
      await serving(
        fetch,
        async (files) => {
          await get(files, "pdftex/26/article.cls");
          await get(files, "pdftex/3/cmr10");
          assert.equal((await get(files, "pdftex/26/article.cfg")).status, 301);
          // Asked twice in one build: the host is asked once
          assert.equal((await get(files, "pdftex/26/article.cfg")).status, 301);
          assert.equal(asked.length, 3);
        },
        root,
      );
      assert.deepEqual(JSON.parse(await readFile(join(root, "engine", "tex", "index.json"), "utf8")), { "26/article.cls": "article.cls", "3/cmr10": "cmr10.tfm", "26/article.cfg": null });
      await serving(
        noNetwork,
        async (files) => {
          assert.deepEqual(await get(files, "pdftex/26/article.cls"), { status: 200, id: "article.cls", body: "the class" });
          assert.deepEqual(await get(files, "pdftex/3/cmr10"), { status: 200, id: "cmr10.tfm", body: "the font" });
          assert.equal((await get(files, "pdftex/26/article.cfg")).status, 301);
          assert.equal(files.trouble, null);
        },
        root,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("takes a file beside the note before any other, and neither keeps it nor asks the host for it", async () => {
    const { fetch, asked } = host({ "26/chapter.tex": { id: "chapter.tex", body: "of the host" } });
    await serving(fetch, async (files, cache, inputs) => {
      await writeFile(join(inputs, "chapter.tex"), "of the note");
      await writeFile(join(inputs, "my picture.png"), "a picture");
      await mkdir(join(inputs, "folder.tex"));
      assert.deepEqual(await get(files, "pdftex/26/chapter.tex"), { status: 200, id: "chapter.tex", body: "of the note" });
      assert.deepEqual(await get(files, "pdftex/26/chapter"), { status: 200, id: "chapter.tex", body: "of the note" });
      assert.deepEqual(await get(files, "pdftex/26/my%20picture.png"), { status: 200, id: "my_20picture.png", body: "a picture" });
      assert.equal((await get(files, "pdftex/26/folder.tex")).status, 301);
      assert.deepEqual(asked, [`${HOST}pdftex/26/folder.tex`]);
      await assert.rejects(readFile(join(cache, "tex", "26", "chapter.tex")));
    });
  });

  it("does not ask the host for the files of the run, nor for a name no file of TeX has", async () => {
    const { fetch, asked } = host({});
    await serving(fetch, async (files) => {
      for (const path of ["pdftex/26/main.aux", "pdftex/26/main.out", "pdftex/26/my%20notes.tex", "pdftex/26/..%2Fsecret.tex", "pdftex/26/a/b.tex", "nothing"]) {
        assert.equal((await get(files, path)).status, 301, path);
      }
      assert.deepEqual(asked, []);
      assert.equal(files.trouble, null);
    });
  });

  it("says why when a file cannot be fetched, and does not keep that as an answer", async () => {
    const root = await mkdtemp(join(tmpdir(), "latex-to-pdf-test-"));
    try {
      await serving(
        noNetwork,
        async (files) => {
          assert.equal((await get(files, "pdftex/26/article.cls")).status, 301);
          assert.match(files.trouble ?? "", /could not fetch "article\.cls" from https:\/\/tex\.example\.org\/: no network for /);
        },
        root,
      );
      const busy: Fetch = () => Promise.resolve({ status: 503, headers: {}, body: new Uint8Array() });
      await serving(
        busy,
        async (files) => {
          assert.equal((await get(files, "pdftex/26/article.cls")).status, 301);
          assert.match(files.trouble ?? "", /the host answered 503/);
        },
        root,
      );
      await serving(
        host({ "26/article.cls": { id: "article.cls", body: "the class" } }).fetch,
        async (files) => {
          assert.deepEqual(await get(files, "pdftex/26/article.cls"), { status: 200, id: "article.cls", body: "the class" });
        },
        root,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fetches a kept file anew when it is gone from the folder", async () => {
    const root = await mkdtemp(join(tmpdir(), "latex-to-pdf-test-"));
    try {
      const { fetch, asked } = host({ "26/article.cls": { id: "article.cls", body: "the class" } });
      await serving(fetch, async (files) => void (await get(files, "pdftex/26/article.cls")), root);
      await rm(join(root, "engine", "tex", "26", "article.cls"));
      await serving(fetch, async (files) => assert.equal((await get(files, "pdftex/26/article.cls")).body, "the class"), root);
      assert.equal(asked.length, 2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("knows when the engine last asked", async () => {
    await serving(host({}).fetch, async (files) => {
      const before = files.busy;
      await new Promise((resolve) => setTimeout(resolve, 15));
      await get(files, "pdftex/26/article.cfg");
      assert.equal(files.busy > before, true);
    });
  });
});
