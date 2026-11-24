import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { askedOf, cachePathOf, engineChoiceOf, engineFor, isOfTheRun, isTexName, namesBeside, passes, TEX_INDEX, withLetters, type Pass } from "./engine.ts";

describe("engineChoiceOf", () => {
  it("reads the choice that was saved", () => {
    assert.equal(engineChoiceOf("installed"), "installed");
    assert.equal(engineChoiceOf("built-in"), "built-in");
    assert.equal(engineChoiceOf("auto"), "auto");
  });

  it("is auto for nothing, and for what is no choice", () => {
    assert.equal(engineChoiceOf(undefined), "auto");
    assert.equal(engineChoiceOf("builtin"), "auto");
    assert.equal(engineChoiceOf(1), "auto");
  });
});

describe("engineFor", () => {
  const found = "/Library/TeX/texbin/pdflatex";

  it("takes the installed program when there is one", () => {
    assert.equal(engineFor("auto", "pdflatex", found), "installed");
    assert.equal(engineFor("installed", "pdflatex", found), "installed");
    assert.equal(engineFor("auto", "xelatex", "/usr/bin/xelatex"), "installed");
  });

  it("takes the built-in engine where pdflatex is not installed", () => {
    assert.equal(engineFor("auto", "pdflatex", null), "built-in");
    assert.equal(engineFor("auto", "/opt/texlive/bin/pdflatex", null), "built-in");
    assert.equal(engineFor("auto", "C:\\texlive\\bin\\PDFLATEX.EXE", null), "built-in");
  });

  it("always takes the built-in engine when the settings say so", () => {
    assert.equal(engineFor("built-in", "pdflatex", found), "built-in");
    assert.equal(engineFor("built-in", "pdflatex", null), "built-in");
  });

  it("fails as before when only the installed program is allowed, and there is none", () => {
    assert.throws(() => engineFor("installed", "pdflatex", null), {
      message: 'The LaTeX program "pdflatex" is not on this computer. Install TeX Live or MacTeX, or name the file of the program in the settings.',
    });
  });

  it("says that the built-in engine is pdfTeX only, for a document that asks for another program", () => {
    assert.throws(() => engineFor("auto", "xelatex", null), /"xelatex" is not on this computer, and the built-in engine is pdfTeX only: it cannot stand in for "xelatex"/);
    assert.throws(() => engineFor("auto", "lualatex", null), /pdfTeX only/);
    assert.throws(() => engineFor("auto", "/opt/bin/mypdflatex", null), /pdfTeX only/);
    assert.throws(() => engineFor("built-in", "xelatex", "/usr/bin/xelatex"), /The built-in engine is pdfTeX only: it cannot build a document that asks for "xelatex"/);
  });
});

describe("askedOf", () => {
  it("reads the kind and the name of the file the engine asks for", () => {
    assert.deepEqual(askedOf("pdftex/26/article.cls"), { key: "26/article.cls", name: "article.cls" });
    assert.deepEqual(askedOf("pdftex/3/cmr10"), { key: "3/cmr10", name: "cmr10" });
    assert.deepEqual(askedOf("pdftex/pk/600/cmr10"), { key: "pk/600/cmr10", name: "cmr10" });
    assert.deepEqual(askedOf("pdftex/26/my%20picture.png"), { key: "26/my picture.png", name: "my picture.png" });
  });

  it("is null for a path the engine does not make, and for a name that leaves its folder", () => {
    for (const path of ["", "pdftex/26/", "pdftex/article.cls", "xetex/26/article.cls", "pdftex/26/a/b.tex", "pdftex/26/..", "pdftex/26/.hidden", "pdftex/26/..%2Fsecret.tex", "pdftex/26/a%5Cb.tex", "pdftex/26/%E0%A4%A", "pdftex/x/article.cls", "pdftex/pk/cmr10", "pdftex/26/a%00b", "pdftex/26/C:secret.tex"]) {
      assert.equal(askedOf(path), null, path);
    }
  });
});

describe("isTexName and isOfTheRun", () => {
  it("knows the names the files of TeX have", () => {
    for (const name of ["article.cls", "cmr10", "l3backend-pdfmode.def", "8r.enc", "pdftex.map", "t1cmr.fd", "c++.sty"]) {
      assert.equal(isTexName(name), true, name);
    }
  });

  it("takes no other name: such a file is not asked of the host", () => {
    for (const name of ["", "my picture.png", "그림.png", "-x.tex", "a/b.tex", "a\\b.tex", "a%b.tex", "a?b"]) {
      assert.equal(isTexName(name), false, name);
    }
  });

  it("knows the files the run itself writes", () => {
    assert.equal(isOfTheRun("main.aux"), true);
    assert.equal(isOfTheRun("main.out"), true);
    assert.equal(isOfTheRun("domain.sty"), false);
    assert.equal(isOfTheRun("mainfont.sty"), false);
  });
});

describe("namesBeside", () => {
  it("tries a name that has no ending with the ending of its kind first", () => {
    assert.deepEqual(namesBeside({ key: "26/part", name: "part" }), ["part.tex", "part"]);
    assert.deepEqual(namesBeside({ key: "6/refs", name: "refs" }), ["refs.bib", "refs"]);
  });

  it("takes a name with an ending as it is, and a kind a document has no files of", () => {
    assert.deepEqual(namesBeside({ key: "26/square.png", name: "square.png" }), ["square.png"]);
    assert.deepEqual(namesBeside({ key: "3/cmr10", name: "cmr10" }), ["cmr10"]);
    assert.deepEqual(namesBeside({ key: "pk/600/cmr10", name: "cmr10" }), ["cmr10"]);
  });
});

describe("cachePathOf", () => {
  it("keeps each answer under its kind and name, beside the list of what is kept", () => {
    assert.equal(cachePathOf({ key: "26/article.cls", name: "article.cls" }), "tex/26/article.cls");
    assert.equal(cachePathOf({ key: "pk/600/cmr10", name: "cmr10" }), "tex/pk/600/cmr10");
    assert.equal(TEX_INDEX, "tex/index.json");
  });
});

describe("passes", () => {
  const pdf = (body: string, made: string): Uint8Array => new TextEncoder().encode(`%PDF-1.5\n<< /CreationDate (D:${made}) >>\n${body}\n%%EOF\n`);
  const written = "Output written on main.pdf (2 pages, 100 bytes).";
  const rerun = "Package rerunfilecheck Warning: File `main.out' has changed.\n(rerunfilecheck)                Rerun to get outlines right\n";

  /** Gives one pass after the other, and counts how many were asked for */
  const engine = (given: Pass[]): { run: () => Promise<Pass>; asked: () => number } => {
    let at = 0;
    return {
      run: () => Promise.resolve(given[at++] ?? { pdf: null, log: "! Asked for more runs than the test has." }),
      asked: () => at,
    };
  };

  it("runs until the PDF comes out as the run before, but for its times", async () => {
    const { run, asked } = engine([
      { pdf: pdf("no outline", "20261124100000Z"), log: rerun + written },
      { pdf: pdf("outline", "20261124100001Z"), log: written },
      { pdf: pdf("outline", "20261124100002Z"), log: written },
    ]);
    const made = await passes(run, 4);
    assert.equal(made.runs, 3);
    assert.equal(asked(), 3);
    assert.equal(made.pages, 2);
    assert.deepEqual(made.pdf, pdf("outline", "20261124100002Z"));
  });

  it("runs a second time also when the log asks for nothing: the first run may have left something for it", async () => {
    const { run } = engine([
      { pdf: pdf("a", "1"), log: written },
      { pdf: pdf("a", "2"), log: written },
    ]);
    assert.equal((await passes(run, 4)).runs, 2);
  });

  it("runs again while the log asks for it, also when the PDF is the same", async () => {
    const { run } = engine([
      { pdf: pdf("a", "1"), log: written },
      { pdf: pdf("a", "2"), log: rerun + written },
      { pdf: pdf("a", "3"), log: written },
    ]);
    assert.equal((await passes(run, 4)).runs, 3);
  });

  it("stops at the most runs for a document that never settles", async () => {
    const { run, asked } = engine([1, 2, 3, 4, 5, 6].map((n) => ({ pdf: pdf(`page ${String(n)}`, "1"), log: rerun + written })));
    const made = await passes(run, 4);
    assert.equal(made.runs, 4);
    assert.equal(asked(), 4);
    assert.deepEqual(made.pdf, pdf("page 4", "1"));
  });

  it("throws the errors of the document, with the line, and runs no more", async () => {
    const { run, asked } = engine([
      { pdf: pdf("a", "1"), log: written },
      { pdf: null, log: "(main.tex\n! Undefined control sequence.\nl.21 Words of the \\nope\n                        smaller part.\n!  ==> Fatal error occurred, no output PDF file produced!\n" },
      { pdf: pdf("a", "3"), log: written },
    ]);
    await assert.rejects(passes(run, 4), { message: "! Undefined control sequence.\nl.21 Words of the \\nope\n!  ==> Fatal error occurred, no output PDF file produced!" });
    assert.equal(asked(), 2);
  });

  it("says that the engine failed when it wrote nothing", async () => {
    await assert.rejects(passes(engine([{ pdf: null, log: "" }]).run, 4), { message: "The built-in engine ended with an error." });
  });
});

describe("withLetters", () => {
  it("tells the engine to write the letters of the signs into the PDF, and keeps the lines where they were", () => {
    const latex = "\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}\n";
    const given = withLetters(latex);
    assert.ok(given.startsWith("\\pdfgentounicode=1 \\input{glyphtounicode}\\documentclass{article}\n"));
    assert.equal(given.split("\n").length, latex.split("\n").length);
    assert.ok(given.endsWith(latex));
  });
});
