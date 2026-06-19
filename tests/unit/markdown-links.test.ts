import { describe, expect, it } from "vitest";
import { parseMarkdownAttachments, parseMarkdownReferences } from "../../scripts/lib/markdown-links.js";

describe("parseMarkdownReferences", () => {
  it("finds wiki links and local markdown links outside code", () => {
    const refs = parseMarkdownReferences(`
See [[001_doc]] and [Index](000_index.md).
Ignore \`[[literal]]\`.
\`\`\`
Ignore [[code_block]]
\`\`\`
`);

    expect(refs.map((ref) => ref.target)).toEqual(["001_doc", "000_index.md"]);
  });

  it("ignores wiki links inside indented fenced code blocks", () => {
    const refs = parseMarkdownReferences(`
  \`\`\`
[[inside_code]]
  \`\`\`
[[outside_code]]
`);

    expect(refs.map((ref) => ref.target)).toEqual(["outside_code"]);
  });

  it("parses local markdown links with spaces in the destination", () => {
    const refs = parseMarkdownReferences("[Doc](My Doc.md)");

    expect(refs.map((ref) => ref.target)).toEqual(["My Doc.md"]);
  });

  it("ignores wiki links inside 4-space indented code blocks", () => {
    const refs = parseMarkdownReferences("    [[indented_code]]\n[[real]]");

    expect(refs.map((ref) => ref.target)).toEqual(["real"]);
  });

  it("parses markdown links with quoted title syntax", () => {
    const refs = parseMarkdownReferences(`[Doc](foo.md "Title")`);

    expect(refs.map((ref) => ref.target)).toEqual(["foo.md"]);
  });

  it("parses markdown links with single-quoted title syntax", () => {
    const refs = parseMarkdownReferences("[Doc](foo.md 'Title')");

    expect(refs.map((ref) => ref.target)).toEqual(["foo.md"]);
  });

  it("parses markdown links with parenthesized title syntax", () => {
    const refs = parseMarkdownReferences("[Doc](foo.md (Title))");

    expect(refs.map((ref) => ref.target)).toEqual(["foo.md"]);
  });
});

describe("parseMarkdownAttachments", () => {
  it("parses attachment paths with balanced parentheses", () => {
    const attachments = parseMarkdownAttachments("![Image](assets/foo(1).png)");

    expect(attachments.map((attachment) => attachment.target)).toEqual(["assets/foo(1).png"]);
  });
});
