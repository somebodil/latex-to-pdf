import { FileSystemAdapter, Notice, Plugin, PluginSettingTab, Setting, TFile, type App } from "obsidian";
import { dirname, join } from "node:path";
import { compile, findProgram } from "./compile.ts";
import { isLatexNote, latexOf, pdfPathOf, programOf } from "./latex.ts";
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
}

const DEFAULT_SETTINGS: Settings = { program: "pdflatex" };

/** What came of one note */
interface Built {
  note: string;
  pdf: string;
  pages: number | null;
  bytes: number;
  /** False when the PDF that was there is the same but for the time it was made, and was left as it is */
  written: boolean;
}

export default class LatexToPdfPlugin extends Plugin {
  private readonly config: Settings = { ...DEFAULT_SETTINGS };

  override async onload(): Promise<void> {
    const saved = (await this.loadData()) as Partial<Settings> | null;
    if (typeof saved?.program === "string" && saved.program.trim() !== "") {
      this.config.program = saved.program.trim();
    }

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
        runner.log(`${one.pdf}: ${one.pages === null ? "" : `${String(one.pages)} pages, `}${String(one.bytes)} bytes${one.written ? "" : ", the same as before"}`);
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
    const said = done.map((one) => `${one.pdf}${one.pages === null ? "" : `: ${String(one.pages)} pages`}${one.written ? "" : " (the same as before)"}`);
    notice.setMessage([...(said.length > 0 ? ["Built:", ...said] : []), ...(failed.length > 0 ? ["Not built:", ...failed] : [])].join("\n"));
    window.setTimeout(() => notice.hide(), failed.length > 0 ? 20_000 : 6000);
  }

  /** Builds the LaTeX of one note into the PDF beside it */
  private async build(note: TFile): Promise<Built> {
    const { vault } = this.app;
    if (!(vault.adapter instanceof FileSystemAdapter)) {
      throw new Error("A PDF is built on a computer only: the LaTeX program runs there.");
    }
    const latex = latexOf(await vault.read(note));
    if (latex === null) {
      throw new Error(`"${note.path}" holds no LaTeX document: it is looked for in a block of code.`);
    }
    const name = programOf(latex) ?? this.config.program;
    const program = findProgram(name);
    if (program === null) {
      throw new Error(`The LaTeX program "${name}" is not on this computer. Install TeX Live or MacTeX, or name the file of the program in the settings.`);
    }
    const made = await compile(latex, program, join(vault.adapter.getBasePath(), dirname(note.path)));

    const path = pdfPathOf(note.path);
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
    return { note: note.path, pdf: path, pages: made.pages, bytes: made.pdf.byteLength, written };
  }
}

class LatexToPdfSettingTab extends PluginSettingTab {
  private readonly plugin: LatexToPdfPlugin;

  constructor(app: App, plugin: LatexToPdfPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  override display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl)
      .setName("LaTeX program")
      .setDesc("The program that builds a document which asks for none: its name, as pdflatex, xelatex or lualatex, or the whole path of its file.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.program)
          .setValue(this.plugin.program)
          .onChange((value) => void this.plugin.setProgram(value)),
      );
  }
}
