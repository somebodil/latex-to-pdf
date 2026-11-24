# latex-to-pdf

An [Obsidian](https://obsidian.md) plugin that builds the LaTeX in a note into a PDF beside the note.

A note keeps a LaTeX document in a block of code, where Obsidian shows it as it is written. The plugin hands the document to the LaTeX program of your computer, or to a pdfTeX of its own where the computer has none, and puts the PDF next to the note, or where the note says: `Papers/Resume.tex.md` gives `Papers/Resume.pdf`.

Not made by Obsidian.

## Requirements

- Obsidian 1.8 or later on a computer. Not in the app for phones and tablets: the plugin uses what only the app for computers has.
- One of the two:
    - A LaTeX program on that computer: [TeX Live](https://tug.org/texlive/), [MacTeX](https://tug.org/mactex/) or [MiKTeX](https://miktex.org), with the packages your documents use. Where there is one, it is used.
    - No LaTeX at all, and the network for the first build of a document: the [built-in engine](#the-built-in-engine) then builds it.

## The note

````markdown
---
type: private
---

```latex
\documentclass{article}
\begin{document}
Hello
\end{document}
```
````

- The document is the first block of code that is marked `latex` or `tex`, or that holds `\documentclass`. A note that is nothing but the document, with no block around it, is taken whole, without its properties.
- A note that is named `Name.tex.md` is a LaTeX note: the command for every note builds these. The PDF is `Name.pdf`, beside the note.
- The property `pdf` of a note puts the PDF somewhere else: a path from the root of the vault, as `pdf: Resume.pdf` for the top of the vault or `pdf: Papers/CV.pdf`. A folder that is not there is made. The path has to end in `.pdf` and to stay inside the vault: a build never writes over a file of another kind.
- A file the document takes in by name, as a picture or another `.tex` file, is looked for in the folder of the note.
- A comment among the first lines chooses the program for one document, as editors of LaTeX read it: `% !TEX program = xelatex`. The programs are `pdflatex`, `xelatex` and `lualatex`. Without the comment, the program of the settings is used: to begin with, `pdflatex`. The built-in engine stands in for `pdflatex` only.

## Commands

- **Build the PDF of this note** builds the note that is open.
- **Build the PDF of every LaTeX note** builds each note that is named `.tex.md`.

A notice says what was built, with the number of pages and what built it, the installed program or the built-in engine, or what LaTeX found wrong, with the line.

## The built-in engine

A computer without LaTeX builds a document as well: with pdfTeX made into WebAssembly by the [SwiftLaTeX](https://github.com/SwiftLaTeX/SwiftLaTeX) project, which runs inside Obsidian.

The setting **Engine** says what builds a document:

| Engine | What builds |
| --- | --- |
| The installed program, or the built-in engine where there is none | To begin with. A computer that has the LaTeX program builds as it always did. |
| The installed program only | Never the built-in engine: without the program, the build fails and says so. |
| The built-in engine only | Always the built-in engine, also where a program is installed. |

What to know of the built-in engine:

- **It is pdfTeX only.** It stands in for `pdflatex`. A document that asks for `xelatex` or `lualatex` is not built by it: where that program is not installed, the build fails and says that the built-in engine is pdfTeX only.
- **Its TeX is older than a TeX Live of today:** pdfTeX 1.40.21 with the LaTeX of February 2020, and the classes and packages of that time. A document that needs a newer package, or a newer version of one, does not build with it.
- **The first build of a document needs the network and takes longer.** The engine has no files of TeX: it is given each class, package and font by name, when a document asks for it. See [Network use](#network-use). What was fetched is kept in the folder of the plugin (`engine/` in `.obsidian/plugins/latex-to-pdf/`), so a second build needs no network. Measured on a tablet with Linux: the first build of a résumé of two pages fetched 16.6 MB and took 50 seconds, of which the format of LaTeX (10.4 MB) and the list of fonts (4.8 MB) are fetched once for all documents. A second build took 2 seconds, with nothing fetched.
- **A file of the note's folder is found by its name:** `\input{part}`, `\includegraphics{picture.png}`, the `.bib` file of `\bibliography{refs}`. **A file in a folder below is not:** `\includegraphics{figures/picture.png}` fails with the built-in engine, which never asks for a name with a folder in it. Put the file beside the note.
- **Its PDF is not, byte for byte, the PDF of an installed program:** the text, the lines and the pages are the same, a letter can stand a part of a point further to the side, and the file is not the same. A vault that is built with the installed program on one computer and with the built-in engine on another gets a changed PDF when the computer changes.
- **Its PDF is read by programs as that of a LaTeX of today:** the older LaTeX does not write into a PDF which letters its signs stand for, and "fi" set as one sign would be taken out as that sign, by a search or by the software an application for a job goes through. The plugin has the engine write them (`\pdfgentounicode=1` with `glyphtounicode`), as a LaTeX of today does by itself.
- The kept files are yours to take away: without the folder `engine/`, the next build fetches again. The folder tells git to pass over it.

## Network use

With an installed LaTeX program, the plugin uses no network.

The built-in engine asks one service for the files of TeX a document uses: **`texlive.texlyre.org`**, the files of a TeX Live that the [TeXlyre](https://github.com/TeXlyre/texlive-ondemand-server) project hands out by name for engines of this kind. It is not a service of this plugin, nor of Obsidian. The endpoint of SwiftLaTeX itself does not answer any more.

- **What is asked:** one request for each file, by its name and its kind, as `https://texlive.texlyre.org/pdftex/26/article.cls`: classes, packages, fonts, and the format of LaTeX. Every file the document asks for that is not beside the note is asked for there, also one of your own that is missing: `\input{chapter-two}` with no such file beside the note asks the service for the name `chapter-two`.
- **What is not sent:** nothing of the document, and no name of a note. The requests carry a name of a file and nothing else. The files of the run itself, as `main.aux`, are never asked for.
- **Why:** the engine comes with no files of TeX, and a TeX Live is several gigabytes. A document uses a few dozen files of it.
- **How often:** once for each file. The answer is kept in the folder of the plugin, also the answer that there is no such file.
- While it builds, the plugin listens on the computer itself (`127.0.0.1`, at a port that is free, with a word in the address that is made for that build): the engine asks there, and the plugin answers from what is kept or asks the service. Nothing outside the computer can reach it.

The files of the service are used as they come: they are not checked against anything. The engine itself is checked: see [Development](#development).

## How a PDF is built

- The program runs in a folder of its own, which is gone afterwards. Nothing but the PDF comes to the vault. The built-in engine runs in a worker of Obsidian and writes into memory only.
- It runs again while what one run leaves for the next still changes, at most four times: the numbers of pages and sections, and the outline of the PDF, are right only then. The built-in engine keeps what it leaves to itself, so it runs again while it asks for another run or its PDF still comes out different: mostly one run more than the installed program.
- A document cannot start programs of the computer (`-no-shell-escape`), and an error ends the run in place of waiting for an answer. The built-in engine is made that way.
- A run of the installed program may take two minutes. The built-in engine is stopped when it has been still for two minutes: it is not still while it is handed a file.
- A PDF that comes out the same as the one that is there, but for the time it was made, is not written again. So a vault that is synced or kept in version control does not get a changed file with every build.
- The program is looked for where the path of the computer says, and in the places TeX Live, MacTeX and Homebrew install to: an app that is started from the dock is not told the path a terminal has. The settings take the whole path of a program as well.

## Building without the window

With [obsidian-cmd-runner](https://github.com/somebodil/obsidian-cmd-runner), a PDF is built by a script or on a build server, with the LaTeX program that is installed there or with the built-in engine:

```sh
obsidian-cmd-runner --vault notes --plugin path/to/latex-to-pdf --command latex-to-pdf:build
```

The run builds every note that is named `.tex.md`, or the notes it is given: `--arg 'latex={"notes":["Papers/Resume.tex.md"]}'`. It gives back each PDF with its pages and size, what built it (`"engine": "installed"` or `"built-in"`) and how many bytes the built-in engine fetched for it, and fails when a document has an error or no LaTeX note is found. Named before the command of another plugin, it makes the PDF that the other then uses: as a site that holds the PDF.

A plugin that is brought with `--plugin` is taken out after the run, and what the built-in engine has kept goes with it: every run then fetches all files again. Install the plugin in the vault to keep them. The engine is chosen with the settings: `--settings latex-to-pdf=settings.json`, with `{"engine": "installed"}` for a build server that must not use the built-in engine.

## Limits

- **No bibliography run with the installed program.** `bibtex` and `biber` are not started, so a document with citations from a `.bib` file comes out without them. The built-in engine runs a BibTeX of its own after each run: with it, the citations of a `.bib` file beside the note are in the PDF. It has no `biber`.
- **One document a note.** Of several blocks of LaTeX in a note, the first is built.

## What was tried, and what was not

- **Tried** in Obsidian 1.15.1 on a Mac with the `pdflatex` of TeX Live, through obsidian-cmd-runner: a résumé of two pages with nine packages, built into the PDF beside its note and, with the property `pdf`, into one at the top of the vault, the same text as the PDF made from it elsewhere. A second build left the PDF as it was.
- **Tried with the built-in engine** in Obsidian 1.15.1 on Linux (arm64) with no LaTeX installed, through obsidian-cmd-runner: the same résumé, with the same text as a program reads it, the same outline, the same lines and pages, and each letter within about a third of a point (0.12 mm) of where the `pdflatex` of the Mac puts it: up and down the same, and sideways further off in some lines, after a space; a second build, which left the PDF as it was; a build with the network cut, from what was kept; a document with an error, which fails with the error and its line; a document that asks for `xelatex`; a document that takes in a `.tex` file, pictures and a `.bib` file from the folder of its note; and a document that never ends, which is stopped.
- **On a Mac** with a `pdflatex` installed and Obsidian 1.15.1: the installed program is still what builds, and leaves the PDF that is there as it is; set to the built-in engine, the same résumé is built in 33 seconds the first time and in under a second after.
- **Not tried:** the commands by hand in the window, `xelatex` and `lualatex`, Windows, the installed program on Linux, a document that takes in files with the installed program, and the built-in engine on macOS and Windows.

## Development

```sh
npm install
npm run check          # types, lint, and the tests that need no Obsidian
npm run build          # main.js without the built-in engine: 17 kB
npm run build:engine   # main.js with the built-in engine inside: 833 kB
```

The built-in engine is two files of the SwiftLaTeX project, `swiftlatexpdftex.js` and `swiftlatexpdftex.wasm`. They are not in this repository. `src/pins.ts` names them as the site of SwiftLaTeX publishes them, by the commit that holds them, with the SHA-256 of each: a file that is anything else is refused, in the build and in the plugin.

- **`npm run build:engine` is the build for a release.** It fetches the two files into `.engine/`, which git passes over, checks them, and puts them into `main.js`. The plugin then fetches no part of itself.
- **`npm run build` is for development.** Its `main.js` has no engine: where no LaTeX program is installed, the plugin fetches the two files from `raw.githubusercontent.com` the first time it needs them, checks them, and keeps them in its folder. A plugin in the community directory of Obsidian may not fetch its own parts, so this build is not for a release there.

Where the engine comes from is one place in the source, `src/engine-files.ts`. Nothing of SwiftLaTeX is copied into this repository: the engine is run as it is published, in a worker, and told what to do with the messages its script answers to (`src/builtin.ts`).

## License

MIT, for what is in this repository.

The built-in engine is not in this repository, and has licences of its own: the [SwiftLaTeX](https://github.com/SwiftLaTeX/SwiftLaTeX) repository is under AGPL-3.0, and [pdfTeX](https://www.tug.org/applications/pdftex/), which its `.wasm` is made of, under GPL-2.0-or-later. A `main.js` that is built with `npm run build:engine` holds these two files, and whoever passes it on has to follow their licences for them.
