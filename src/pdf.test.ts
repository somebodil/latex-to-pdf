import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pagesOf, samePdf } from "./pdf.ts";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const pdf = (made: string, id: string, body = "BT (Hello) Tj ET"): Uint8Array =>
  bytes(`%PDF-1.5\n1 0 obj\n<< /Producer (pdfTeX-1.40.27) /CreationDate (D:${made}) /ModDate (D:${made}) >>\nendobj\n${body}\ntrailer << /ID [<${id}> <${id}>] >>\n%%EOF\n`);

describe("samePdf", () => {
  it("takes two builds of the same document as the same", () => {
    assert.equal(samePdf(pdf("20261124100000+09'00'", "AB12"), pdf("20270102030405+09'00'", "CD34")), true);
  });

  it("sees another text, also one of the same length", () => {
    assert.equal(samePdf(pdf("20261124100000+09'00'", "AB12"), pdf("20261124100000+09'00'", "AB12", "BT (Hallo) Tj ET")), false);
    assert.equal(samePdf(pdf("20261124100000+09'00'", "AB12"), pdf("20261124100000+09'00'", "AB12", "BT (Hello!) Tj ET")), false);
  });

  it("keeps bytes that are not text apart", () => {
    assert.equal(samePdf(new Uint8Array([0x25, 0xff, 0x00, 0x80]), new Uint8Array([0x25, 0xff, 0x00, 0x80])), true);
    assert.equal(samePdf(new Uint8Array([0x25, 0xff, 0x00, 0x80]), new Uint8Array([0x25, 0xfe, 0x00, 0x80])), false);
  });
});

describe("pagesOf", () => {
  it("reads the number of pages, also where the line is broken", () => {
    assert.equal(pagesOf("x\nOutput written on main.pdf (2 pages, 129525 bytes).\n"), 2);
    assert.equal(pagesOf("Output written on /a/very/long/path/that/is/bro\nken/main.pdf (1 page, 9 bytes)."), 1);
    assert.equal(pagesOf("No pages of output."), null);
  });
});
