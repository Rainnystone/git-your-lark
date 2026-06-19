import { describe, expect, it } from "vitest";
import { parseMarkdownReferences } from "../../scripts/lib/markdown-links.js";

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
});
