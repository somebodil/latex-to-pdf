import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { askedPdfOf, errorOf, isLatexNote, latexOf, pdfPathOf, programOf, wantsAnotherRun } from "./latex.ts";

const document = "\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}";

describe("latexOf", () => {
  it("takes the document out of the block of code a note keeps it in", () => {
    assert.equal(latexOf(`---\ntype: private\n---\n\n\`\`\`\n${document}\n\`\`\`\n`), document + "\n");
    assert.equal(latexOf(`Some words.\n\n\`\`\`latex\n\\section{x}\n\`\`\`\n`), "\\section{x}\n");
    assert.equal(latexOf(`~~~tex\n${document}\n~~~`), document + "\n");
  });

  it("passes over a block of another language, and takes the first that is LaTeX", () => {
    const note = `\`\`\`js\nconst a = 1;\n\`\`\`\n\n\`\`\`\n${document}\n\`\`\`\n\n\`\`\`latex\nlater\n\`\`\`\n`;
    assert.equal(latexOf(note), document + "\n");
  });

  it("takes a note that is nothing but the document, without its properties", () => {
    assert.equal(latexOf(`---\ntype: private\n---\n${document}\n`), document + "\n");
  });

  it("keeps the lines of the document as they are, also with line ends of Windows", () => {
    assert.equal(latexOf("```\r\n\\documentclass{a}\r\n% a ``quote''\r\n```\r\n"), "\\documentclass{a}\n% a ``quote''\n");
  });

  it("is null for a note without LaTeX", () => {
    assert.equal(latexOf("# A note\n\nWords.\n\n```js\nconst a = 1;\n```\n"), null);
    assert.equal(latexOf(""), null);
  });
});

describe("pdfPathOf and isLatexNote", () => {
  it("puts the PDF beside the note, under its name", () => {
    assert.equal(pdfPathOf("10_Private/Resume.tex.md"), "10_Private/Resume.pdf");
    assert.equal(pdfPathOf("Paper.md"), "Paper.pdf");
    assert.equal(pdfPathOf("a.b/c.d.TEX.MD"), "a.b/c.d.pdf");
  });

  it("puts the PDF where the note asks for it, from the root of the vault", () => {
    assert.equal(pdfPathOf("10_Private/Resume.tex.md", "Resume.pdf"), "Resume.pdf");
    assert.equal(pdfPathOf("10_Private/Resume.tex.md", " /Papers/My CV.PDF "), "Papers/My CV.PDF");
    assert.equal(pdfPathOf("a/b.md", "이력서/이력서.pdf"), "이력서/이력서.pdf");
  });

  it("takes no place outside the vault, and none that is not a PDF", () => {
    for (const asked of ["", "/", "../Resume.pdf", "a/../b.pdf", "a//b.pdf", "a\\b.pdf", "C:/b.pdf", "Resume", "Resume.md", "notes/Resume.tex.md", ".obsidian/x.pdf", "a/.git/x.pdf", "a /b.pdf", "a\tb.pdf"]) {
      assert.equal(pdfPathOf("a/b.md", asked), null, asked);
    }
  });

  it("reads the place from the property of the note", () => {
    assert.equal(askedPdfOf("---\ntype: private\npdf: Resume.pdf\n---\n\n```\nx\n```\n"), "Resume.pdf");
    assert.equal(askedPdfOf('---\r\npdf :  "Papers/My CV.pdf"  \r\n---\r\n'), "Papers/My CV.pdf");
    assert.equal(askedPdfOf("---\npdf: 'a.pdf'\n---"), "a.pdf");
  });

  it("finds no place where the note has no such property", () => {
    assert.equal(askedPdfOf("---\ntype: private\n---\n\npdf: not a property\n"), null);
    assert.equal(askedPdfOf("---\npdf:\nother: 1\n---\n"), null);
    assert.equal(askedPdfOf("---\nmypdf: a.pdf\n---\n"), null);
    assert.equal(askedPdfOf("pdf: a.pdf\n"), null);
    assert.equal(askedPdfOf(""), null);
  });

  it("knows a note that is named as a LaTeX document", () => {
    assert.equal(isLatexNote("x/Resume.tex.md"), true);
    assert.equal(isLatexNote("x/Resume.md"), false);
    assert.equal(isLatexNote("x/latex.md"), false);
  });
});

describe("errorOf and wantsAnotherRun", () => {
  it("finds the errors and where they are", () => {
    const log = "This is pdfTeX\n(./main.tex\n! LaTeX Error: File `fullpage.sty' not found.\n\nType X to quit\nl.12 \\usepackage\n               {titlesec}\n! Emergency stop.\n";
    assert.equal(errorOf(log), "! LaTeX Error: File `fullpage.sty' not found.\n! Emergency stop.");
    assert.equal(errorOf("x\n./main.tex:7: Undefined control sequence.\nl.7 \\nope\n"), "./main.tex:7: Undefined control sequence.\nl.7 \\nope");
  });

  it("gives the end of what was written when no error is marked", () => {
    assert.equal(errorOf("one\ntwo\n"), "one\ntwo");
  });

  it("knows when the program asks for another run", () => {
    assert.equal(wantsAnotherRun("Package rerunfilecheck Warning: File `main.out' has changed.\n(rerunfilecheck)                Rerun to get outlines right"), true);
    assert.equal(wantsAnotherRun("Output written on main.pdf (2 pages)."), false);
  });
});

describe("programOf", () => {
  it("reads the program a document asks for", () => {
    assert.equal(programOf("% !TEX program = xelatex\n\\documentclass{article}"), "xelatex");
    assert.equal(programOf("%!TEX TS-program = LuaLaTeX\n"), "lualatex");
    assert.equal(programOf("% a comment\n\n% !TeX program=pdflatex\n"), "pdflatex");
  });

  it("is null for none, and for a program that is not one of LaTeX", () => {
    assert.equal(programOf("\\documentclass{article}"), null);
    assert.equal(programOf("% !TEX program = /bin/sh\n"), null);
    assert.equal(programOf("% !TEX program = rm\n"), null);
  });
});
