/**
 * Hands the built-in engine its files while it runs. This is a part that
 * needs a desktop: it listens on the computer itself, and keeps files in a
 * folder.
 *
 * The engine asks for every file of TeX by name, with a request that waits
 * for its answer: `pdftex/26/article.cls`. It is told to ask here, at an
 * address on this computer. A name is looked for beside the note first, then
 * in the cache, and only then asked of the host, whose answer is kept: so a
 * second build needs no network, and the engine itself never talks to
 * anything but this computer.
 */

import { randomBytes } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { keep, type EngineFiles } from "./engine-files.ts";
import { askedOf, cachePathOf, isOfTheRun, isTexName, namesBeside, TEX_INDEX, type Asked, type Fetch } from "./engine.ts";
import { ENGINE, TEX_HOST } from "./pins.ts";

export interface TexFiles {
  /** Where the engine asks. The address holds a word that is made for this build and told to nothing but the engine. */
  url: string;
  /** Why a file could not be fetched, or null. The engine was told that there is no such file, so what it built is not to be used. */
  trouble: string | null;
  /** When the engine last asked for a file, or was given one: the time since tells an engine that waits from one that hangs */
  busy: number;
  close(): Promise<void>;
}

/** What the page of the engine may read of an answer: it is on another address than the page */
const OPEN = { "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "fileid, pkid", "Cache-Control": "no-store" };

type Index = Record<string, string | null>;

/** The file of that name in the folder, or null when there is none */
async function fileIn(folder: string, name: string): Promise<Uint8Array | null> {
  const path = join(folder, name);
  if (!(await stat(path).then((found) => found.isFile(), () => false))) {
    return null;
  }
  return new Uint8Array(await readFile(path));
}

/**
 * Starts to hand out files, for one build.
 *
 * @param engine the files of the engine itself: its page takes them from here as well
 * @param cache the folder where the files of TeX are kept
 * @param inputs the folder of the note, where files the document takes in by name are looked for
 * @param host where a file of TeX that is not kept is asked for
 */
export async function serveTexFiles(engine: EngineFiles, cache: string, inputs: string, fetch: Fetch, host: string = TEX_HOST): Promise<TexFiles> {
  const word = randomBytes(16).toString("hex");
  const index = await readFile(join(cache, TEX_INDEX), "utf8")
    .then((text) => JSON.parse(text) as unknown)
    .then((read): Index => (typeof read === "object" && read !== null && !Array.isArray(read) ? (read as Index) : {}))
    // No list yet, or one that cannot be read: the files are fetched anew
    .catch((): Index => ({}));
  let changed = false;
  const files: TexFiles = { url: "", trouble: null, busy: Date.now(), close: () => Promise.resolve() };

  /** The file and the name the engine saves it under, or null for a file there is none of */
  const find = async (asked: Asked): Promise<{ body: Uint8Array; id: string } | null> => {
    for (const name of namesBeside(asked)) {
      const beside = await fileIn(inputs, name);
      if (beside !== null) {
        // A name that cannot go into a header is given one that can: the engine saves the file under it, and nothing else
        return { body: beside, id: isTexName(name) ? name : encodeURIComponent(name).replace(/%/g, "_") };
      }
    }
    if (isOfTheRun(asked.name) || !isTexName(asked.name)) {
      return null;
    }
    const known = index[asked.key];
    if (known === null) {
      return null;
    }
    const path = join(cache, cachePathOf(asked));
    if (typeof known === "string" && isTexName(known)) {
      const body = await readFile(path).catch(() => null);
      if (body !== null) {
        return { body: new Uint8Array(body), id: known };
      }
    }
    const got = await fetch(`${host}pdftex/${asked.key}`);
    if (got.status === 200) {
      const named = got.headers.fileid ?? got.headers.pkid ?? "";
      const id = isTexName(named) ? named : asked.name;
      await keep(path, got.body);
      index[asked.key] = id;
      changed = true;
      return { body: got.body, id };
    }
    // The host says 301 for a file it does not have
    if (got.status !== 301 && got.status !== 404) {
      throw new Error(`the host answered ${String(got.status)}`);
    }
    index[asked.key] = null;
    changed = true;
    return null;
  };

  const answer = async (path: string, response: ServerResponse): Promise<void> => {
    if (path === ENGINE.script.name) {
      response.writeHead(200, { ...OPEN, "Content-Type": "text/javascript" }).end(engine.script);
      return;
    }
    if (path === ENGINE.wasm.name) {
      response.writeHead(200, { ...OPEN, "Content-Type": "application/wasm" }).end(engine.wasm);
      return;
    }
    const asked = askedOf(path);
    let found: Awaited<ReturnType<typeof find>> = null;
    if (asked !== null) {
      try {
        found = await find(asked);
      } catch (error) {
        files.trouble ??= `The built-in engine could not fetch "${asked.name}" from ${host}: ${error instanceof Error ? error.message : String(error)}. A document needs the network until its files of TeX are kept.`;
      }
    }
    if (found === null) {
      // As the host says it: the engine then takes the file as one there is none of
      response.writeHead(301, OPEN).end();
    } else {
      response.writeHead(200, { ...OPEN, "Content-Type": "application/octet-stream", fileid: found.id, pkid: found.id }).end(found.body);
    }
  };

  const server: Server = createServer((request, response) => {
    files.busy = Date.now();
    const path = (request.url ?? "").split("?")[0] ?? "";
    const done = (): void => {
      files.busy = Date.now();
    };
    if (request.method !== "GET" || !path.startsWith(`/${word}/`)) {
      response.writeHead(404, OPEN).end();
      return;
    }
    answer(path.slice(word.length + 2), response)
      .catch(() => {
        if (!response.headersSent) {
          response.writeHead(500, OPEN);
        }
        response.end();
      })
      .finally(done);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    // On this computer only, at a port that is free
    server.listen(0, "127.0.0.1", resolve);
  });
  files.url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/${word}/`;
  files.close = async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    if (changed) {
      await keep(join(cache, TEX_INDEX), JSON.stringify(index, null, 1));
    }
  };
  return files;
}
