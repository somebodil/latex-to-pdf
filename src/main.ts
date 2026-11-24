import { FileSystemAdapter, normalizePath, Notice, Plugin, PluginSettingTab, requestUrl, Setting, TFile, type App, type SettingDefinitionItem } from "obsidian";
import { dirname, join } from "node:path";
import inlined from "inlined-engine";
import { compileBuiltIn, type BuiltIn } from "./builtin.ts";
import { compile, findProgram, type Compiled } from "./compile.ts";
import { inlinedEngine } from "./engine-files.ts";
import { engineChoiceOf, engineFor, ENGINES, type Engine, type EngineChoice, type Fetch } from "./engine.ts";
import { askedPdfOf, isLatexNote, latexOf, pdfPathOf, programOf } from "./latex.ts";
import { samePdf } from "./pdf.ts";

/**
 * What a program that runs Obsidian without its window leaves in the page
 * for a command (obsidian-cmd-runner). It is not there when a person runs
 * the command.
 */
interface Runner {
  /** What the run was given: `latex.notes` names the notes to build, in place of every note that is named `.tex.md` */
  args: Record<string, unknown>;
  claim(): void;
  done(result?: unknown): void;
  fail(error: unknown): void;
  log(message: string): void;
}

interface Settings {
  /** The LaTeX program for a document that asks for none: a name, or the whole path of a file */
  program: string;
  /** What builds a document: the installed program, the built-in engine, or the built-in engine where no program is installed */
  engine: EngineChoice;
}

const DEFAULT_SETTINGS: Settings = { program: "pdflatex", engine: "auto" };

/** What the settings show for each choice */
const ENGINE_NAMES: Record<EngineChoice, string> = {
  auto: "The installed program, or the built-in engine where there is none",
  installed: "The installed program only",
  "built-in": "The built-in engine only",
};

/** A request as Obsidian makes it: an answer that is not 200 is given back, and not thrown */
const fetchUrl: Fetch = async (url) => {
  const got = await requestUrl({ url, throw: false });
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(got.headers)) {
    headers[name.toLowerCase()] = value;
  }
  return { status: got.status, headers, body: new Uint8Array(got.arrayBuffer) };
};

/** What came of one note */
interface Built {
  note: string;
  pdf: string;
  pages: number | null;
  bytes: number;
  /** False when the PDF that was there is the same but for the time it was made, and was left as it is */
  written: boolean;
  /** What built it: the LaTeX program of the computer, or the engine that comes with the plugin */
  engine: Engine;
  /** How many bytes the built-in engine had fetched for it: nothing when all it needs is kept */
  fetched?: number;
}

/** What built a PDF, for a person */
function engineSaid(one: Built): string {
  return one.engine === "installed" ? "installed program" : `built-in engine${one.fetched === undefined || one.fetched === 0 ? "" : `, ${String(one.fetched)} bytes fetched`}`;
}

export default class LatexToPdfPlugin extends Plugin {
  private readonly config: Settings = { ...DEFAULT_SETTINGS };

  override async onload(): Promise<void> {
    const saved = (await this.loadData()) as Partial<Settings> | null;
    if (typeof saved?.program === "string" && saved.program.trim() !== "") {
      this.config.program = saved.program.trim();
    }
    this.config.engine = engineChoiceOf(saved?.engine);

    this.addCommand({
      id: "build-note",
      name: "Build the PDF of this note",
      icon: "file-output",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (file === null || file.extension !== "md") {
          return false;
        }
        if (!checking) {
          void this.byHand([file]);
        }
        return true;
      },
    });
    this.addCommand({
      id: "build",
      name: "Build the PDF of every LaTeX note",
      icon: "files",
      callback: () => void this.buildAll(),
    });
    this.addSettingTab(new LatexToPdfSettingTab(this.app, this));
  }

  get program(): string {
    return this.config.program;
  }

  async setProgram(program: string): Promise<void> {
    this.config.program = program.trim() === "" ? DEFAULT_SETTINGS.program : program.trim();
    await this.saveData(this.config);
  }

  get engine(): EngineChoice {
    return this.config.engine;
  }

  async setEngine(engine: EngineChoice): Promise<void> {
    this.config.engine = engine;
    await this.saveData(this.config);
  }

  /**
   * What the built-in engine needs. What it fetches is kept in a folder of
   * the plugin, which goes when the plugin is taken out.
   */
  private builtIn(root: string): BuiltIn {
    const cache = join(root, this.manifest.dir ?? join(this.app.vault.configDir, "plugins", this.manifest.id), "engine");
    return { engine: inlinedEngine(inlined), cache, fetch: fetchUrl };
  }

  /** The notes that are named as LaTeX documents: `Name.tex.md` */
  private latexNotes(): TFile[] {
    return this.app.vault
      .getMarkdownFiles()
      .filter((file) => isLatexNote(file.path))
      .sort((a, b) => (a.path < b.path ? -1 : 1));
  }

  private async buildAll(): Promise<void> {
    const runner = (window as unknown as { obsidianCmdRunner?: Runner }).obsidianCmdRunner;
    if (runner === undefined) {
      await this.byHand(this.latexNotes());
      return;
    }
    runner.claim();
    try {
      const started = Date.now();
      const asked = (runner.args.latex as { notes?: unknown } | undefined)?.notes;
      const notes = Array.isArray(asked) ? asked.map((path) => this.noteAt(String(path))) : this.latexNotes();
      if (notes.length === 0) {
        throw new Error("There is no LaTeX note to build: none is named `.tex.md`, and none was named for the run.");
      }
      const built: Built[] = [];
      for (const note of notes) {
        const one = await this.build(note);
        runner.log(`${one.pdf}: ${one.pages === null ? "" : `${String(one.pages)} pages, `}${String(one.bytes)} bytes${one.written ? "" : ", the same as before"}, ${engineSaid(one)}`);
        built.push(one);
      }
      runner.done({ built, seconds: Math.round((Date.now() - started) / 100) / 10 });
    } catch (error) {
      runner.fail(error);
    }
  }

  private noteAt(path: string): TFile {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.extension !== "md") {
      throw new Error(`There is no note "${path}".`);
    }
    return file;
  }

  /** Builds for a person: says what is going on, and what came of it */
  private async byHand(notes: TFile[]): Promise<void> {
    if (notes.length === 0) {
      new Notice("There is no LaTeX note: a note that is named as Name.tex.md is one.", 8000);
      return;
    }
    const notice = new Notice("Building the PDF", 0);
    const failed: string[] = [];
    const done: Built[] = [];
    for (const note of notes) {
      notice.setMessage(`Building the PDF of "${note.basename}"`);
      try {
        done.push(await this.build(note));
      } catch (error) {
        failed.push(`${note.path}\n${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const said = done.map((one) => `${one.pdf}${one.pages === null ? "" : `: ${String(one.pages)} pages`}${one.written ? "" : " (the same as before)"}, ${engineSaid(one)}`);
    notice.setMessage([...(said.length > 0 ? ["Built:", ...said] : []), ...(failed.length > 0 ? ["Not built:", ...failed] : [])].join("\n"));
    window.setTimeout(() => notice.hide(), failed.length > 0 ? 20_000 : 6000);
  }

  /** Builds the LaTeX of one note into the PDF beside it */
  private async build(note: TFile): Promise<Built> {
    const { vault } = this.app;
    if (!(vault.adapter instanceof FileSystemAdapter)) {
      throw new Error("A PDF is built on a computer only: the LaTeX program runs there.");
    }
    const text = await vault.read(note);
    const latex = latexOf(text);
    if (latex === null) {
      throw new Error(`"${note.path}" holds no LaTeX document: it is looked for in a block of code.`);
    }
    // Before the document is built: a place that cannot be written to is a mistake in the note, and it is said at once
    const asked = pdfPathOf(note.path, askedPdfOf(text));
    if (asked === null) {
      throw new Error(`The property "pdf" of "${note.path}" does not name a PDF inside the vault: write its path from the root of the vault, as Papers/Resume.pdf.`);
    }
    const path = normalizePath(asked);
    const name = programOf(latex) ?? this.config.program;
    const program = findProgram(name);
    // Fails here when nothing can build the document: no program of that name, and the built-in engine not allowed or not able
    const engine = engineFor(this.config.engine, name, program);
    const inputs = join(vault.adapter.getBasePath(), dirname(note.path));
    const made: Compiled & { fetched?: number } = engine === "installed" && program !== null ? await compile(latex, program, inputs) : await compileBuiltIn(latex, inputs, this.builtIn(vault.adapter.getBasePath()));

    const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (folder !== "" && !(await vault.adapter.exists(folder))) {
      await vault.createFolder(folder);
    }
    const data = made.pdf.buffer.slice(made.pdf.byteOffset, made.pdf.byteOffset + made.pdf.byteLength) as ArrayBuffer;
    const there = vault.getAbstractFileByPath(path);
    let written = true;
    if (there instanceof TFile) {
      if (samePdf(new Uint8Array(await vault.readBinary(there)), made.pdf)) {
        written = false;
      } else {
        await vault.modifyBinary(there, data);
      }
    } else if (there !== null) {
      throw new Error(`"${path}" is a folder: the PDF cannot be written there.`);
    } else if (await vault.adapter.exists(path)) {
      // A file Obsidian has not come to know yet
      if (samePdf(new Uint8Array(await vault.adapter.readBinary(path)), made.pdf)) {
        written = false;
      } else {
        await vault.adapter.writeBinary(path, data);
      }
    } else {
      await vault.createBinary(path, data);
    }
    return { note: note.path, pdf: path, pages: made.pages, bytes: made.pdf.byteLength, written, engine, ...(made.fetched === undefined ? {} : { fetched: made.fetched }) };
  }
}

/** The words of the settings: said once, for the Obsidian that reads them as a list and for the one that is given them drawn */
const PROGRAM_SETTING = {
  key: "program",
  name: "LaTeX program",
  desc: "The program that builds a document which asks for none: its name, as pdflatex, xelatex or lualatex, or the whole path of its file.",
} as const;
const ENGINE_SETTING = {
  key: "engine",
  name: "Engine",
  desc: "What builds a document. The built-in engine is pdfTeX: it needs no LaTeX on the computer, and fetches the classes, packages and fonts a document uses the first time it uses them.",
} as const;

class LatexToPdfSettingTab extends PluginSettingTab {
  private readonly plugin: LatexToPdfPlugin;

  constructor(app: App, plugin: LatexToPdfPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * The settings as a list. Obsidian 1.13 and later draws them from it, and
   * finds them when the settings are searched; it does not call `display`.
   */
  override getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: PROGRAM_SETTING.name,
        desc: PROGRAM_SETTING.desc,
        aliases: ["pdflatex", "xelatex", "lualatex"],
        control: { type: "text", key: PROGRAM_SETTING.key, placeholder: DEFAULT_SETTINGS.program, defaultValue: DEFAULT_SETTINGS.program },
      },
      {
        name: ENGINE_SETTING.name,
        desc: ENGINE_SETTING.desc,
        aliases: ["pdfTeX", "built-in"],
        control: { type: "dropdown", key: ENGINE_SETTING.key, options: { ...ENGINE_NAMES }, defaultValue: DEFAULT_SETTINGS.engine },
      },
    ];
  }

  /** The settings are kept by the plugin, which makes them right before it keeps them: so they are read from it and given to it */
  override getControlValue(key: string): unknown {
    return key === PROGRAM_SETTING.key ? this.plugin.program : key === ENGINE_SETTING.key ? this.plugin.engine : undefined;
  }

  override async setControlValue(key: string, value: unknown): Promise<void> {
    if (key === PROGRAM_SETTING.key) {
      await this.plugin.setProgram(typeof value === "string" ? value : "");
    } else if (key === ENGINE_SETTING.key) {
      await this.plugin.setEngine(engineChoiceOf(value));
    }
  }

  /** For Obsidian before 1.13, which knows nothing of the list above */
  override display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl)
      .setName(PROGRAM_SETTING.name)
      .setDesc(PROGRAM_SETTING.desc)
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.program)
          .setValue(this.plugin.program)
          .onChange((value) => void this.plugin.setProgram(value)),
      );
    new Setting(this.containerEl)
      .setName(ENGINE_SETTING.name)
      .setDesc(ENGINE_SETTING.desc)
      .addDropdown((dropdown) => {
        for (const engine of ENGINES) {
          dropdown.addOption(engine, ENGINE_NAMES[engine]);
        }
        dropdown.setValue(this.plugin.engine).onChange((value) => void this.plugin.setEngine(engineChoiceOf(value)));
      });
  }
}
