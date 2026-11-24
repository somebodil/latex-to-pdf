# latex-to-pdf

An [Obsidian](https://obsidian.md) plugin that builds the LaTeX in a note into a PDF beside the note.

A note keeps a LaTeX document in a block of code, where Obsidian shows it as it is written. The plugin hands the document to the LaTeX program of your computer and puts the PDF next to the note: `Papers/Resume.tex.md` gives `Papers/Resume.pdf`.

Not made by Obsidian.

## Requirements

- Obsidian 1.8 or later on a computer. Not on a phone or tablet: the LaTeX program runs on a computer only.
- A LaTeX program on that computer: [TeX Live](https://tug.org/texlive/), [MacTeX](https://tug.org/mactex/) or [MiKTeX](https://miktex.org), with the packages your documents use. The plugin holds no LaTeX of its own.

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
- A note that is named `Name.tex.md` is a LaTeX note: the command for every note builds these. The PDF is `Name.pdf`.
- A file the document takes in by name, as a picture or another `.tex` file, is looked for in the folder of the note.
- A comment among the first lines chooses the program for one document, as editors of LaTeX read it: `% !TEX program = xelatex`. The programs are `pdflatex`, `xelatex` and `lualatex`. Without the comment, the program of the settings is used: to begin with, `pdflatex`.

## Commands

- **Build the PDF of this note** builds the note that is open.
- **Build the PDF of every LaTeX note** builds each note that is named `.tex.md`.

A notice says what was built, with the number of pages, or what the LaTeX program found wrong, with the line.

## How a PDF is built

- The program runs in a folder of its own, which is gone afterwards. Nothing but the PDF comes to the vault.
- It runs again while what one run leaves for the next still changes, at most four times: the numbers of pages and sections, and the outline of the PDF, are right only then.
- A document cannot start programs of the computer (`-no-shell-escape`), and an error ends the run in place of waiting for an answer.
- A PDF that comes out the same as the one that is there, but for the time it was made, is not written again. So a vault that is synced or kept in version control does not get a changed file with every build.
- The program is looked for where the path of the computer says, and in the places TeX Live, MacTeX and Homebrew install to: an app that is started from the dock is not told the path a terminal has. The settings take the whole path of a program as well.

## Building without the window

With [obsidian-cmd-runner](https://github.com/somebodil/obsidian-cmd-runner), a PDF is built by a script or on a build server, which needs a LaTeX program installed:

```sh
obsidian-cmd-runner --vault notes --plugin path/to/latex-to-pdf --command latex-to-pdf:build
```

The run builds every note that is named `.tex.md`, or the notes it is given: `--arg 'latex={"notes":["Papers/Resume.tex.md"]}'`. It gives back each PDF with its pages and size, and fails when a document has an error or no LaTeX note is found. Named before the command of another plugin, it makes the PDF that the other then uses: as a site that holds the PDF.

## Limits

- **No bibliography run.** `bibtex` and `biber` are not started, so a document with citations from a `.bib` file comes out without them.
- **One document a note.** Of several blocks of LaTeX in a note, the first is built.

## What was tried, and what was not

- **Tried** in Obsidian 1.15.1 on a Mac with the `pdflatex` of TeX Live, through obsidian-cmd-runner: a résumé of two pages with nine packages, built into the PDF beside its note, the same text as the PDF made from it elsewhere. A second build left the PDF as it was.
- **Not tried:** the commands by hand in the window, `xelatex` and `lualatex`, Windows and Linux, and a document that takes in files.

## Development

```sh
npm install
npm run check   # types, lint, and the tests that need no Obsidian
npm run build   # main.js
```

## License

MIT
