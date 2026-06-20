import { describe, expect, it } from "vitest";
import { planMarkdownWrite } from "../../scripts/lib/patch-plan.js";
import { renderMarkdownForLark, type ReferenceTarget } from "../../scripts/lib/render.js";

const references: Record<string, ReferenceTarget> = {
  "001_doc": {
    token: "doc_token",
    url: "https://example.test/docs/001_doc"
  },
  "docs/b.md": {
    token: "nested_token",
    url: "https://example.test/docs/b"
  },
  "b.md": {
    token: "root_token",
    url: "https://example.test/root-b"
  }
};

describe("renderMarkdownForLark", () => {
  it("converts wiki links to Lark doc cites and preserves inline code", () => {
    const result = renderMarkdownForLark({
      markdown: "See [[001_doc]] and `[[001_doc]]`.",
      sourcePath: "000_index.md",
      referenceMap: references,
      mode: "lark-doc-cite"
    });

    expect(result.content).toBe('See <cite type="doc" doc-id="doc_token"></cite> and `[[001_doc]]`.');
    expect(result.unresolved).toEqual([]);
  });

  it("converts wiki links to URL links in url-link mode", () => {
    const result = renderMarkdownForLark({
      markdown: "See [[001_doc]].",
      sourcePath: "000_index.md",
      referenceMap: references,
      mode: "url-link"
    });

    expect(result.content).toBe("See [001_doc](https://example.test/docs/001_doc).");
    expect(result.unresolved).toEqual([]);
  });

  it("resolves wiki aliases and anchors by target", () => {
    const result = renderMarkdownForLark({
      markdown: "See [[001_doc#Section|Readable Label]] and [[001_doc|Alias]].",
      sourcePath: "000_index.md",
      referenceMap: references,
      mode: "url-link"
    });

    expect(result.content).toBe(
      "See [Readable Label](https://example.test/docs/001_doc) and [Alias](https://example.test/docs/001_doc)."
    );
    expect(result.unresolved).toEqual([]);
  });

  it("resolves relative markdown links from the source document directory", () => {
    const result = renderMarkdownForLark({
      markdown: "Nested [B](b.md).",
      sourcePath: "docs/a.md",
      referenceMap: references,
      mode: "lark-doc-cite"
    });

    expect(result.content).toBe('Nested <cite type="doc" doc-id="nested_token"></cite>.');
    expect(result.unresolved).toEqual([]);
  });

  it("preserves external, image, non-md, and heading-only links", () => {
    const markdown = [
      "[Web](https://example.test)",
      "![Image](001_doc.md)",
      "[PDF](file.pdf)",
      "[Heading](#local-heading)"
    ].join("\n");

    const result = renderMarkdownForLark({
      markdown,
      sourcePath: "000_index.md",
      referenceMap: references,
      mode: "url-link"
    });

    expect(result.content).toBe(markdown);
    expect(result.unresolved).toEqual([]);
  });

  it("preserves fenced, tilde fenced, and indented code", () => {
    const markdown = [
      "```",
      "[[001_doc]]",
      "```",
      "~~~",
      "[Doc](001_doc.md)",
      "~~~",
      "    [[001_doc]]",
      "Outside [[001_doc]]"
    ].join("\n");

    const result = renderMarkdownForLark({
      markdown,
      sourcePath: "000_index.md",
      referenceMap: references,
      mode: "lark-doc-cite"
    });

    expect(result.content).toBe(
      [
        "```",
        "[[001_doc]]",
        "```",
        "~~~",
        "[Doc](001_doc.md)",
        "~~~",
        "    [[001_doc]]",
        'Outside <cite type="doc" doc-id="doc_token"></cite>'
      ].join("\n")
    );
    expect(result.unresolved).toEqual([]);
  });

  it("returns unresolved references once and keeps original text", () => {
    const result = renderMarkdownForLark({
      markdown: "Missing [[missing_doc]] and again [[missing_doc]]. Also [Missing](missing.md).",
      sourcePath: "000_index.md",
      referenceMap: references,
      mode: "url-link"
    });

    expect(result.content).toBe("Missing [[missing_doc]] and again [[missing_doc]]. Also [Missing](missing.md).");
    expect(result.unresolved).toEqual(["missing_doc", "missing.md"]);
  });
});

describe("planMarkdownWrite", () => {
  it("returns no-change for identical markdown", () => {
    expect(planMarkdownWrite("same\n", "same\n")).toEqual({ kind: "no-change" });
  });

  it("returns str-replace for one unique non-empty changed region", () => {
    expect(planMarkdownWrite("before\nold\nold-2\nafter\n", "before\nnew\nnew-2\nafter\n")).toEqual({
      kind: "str-replace",
      pattern: "old\nold-2\n",
      replacement: "new\nnew-2\n"
    });
  });

  it("requires overwrite when the removed pattern is repeated", () => {
    expect(planMarkdownWrite("same\nold\nsame\nold\n", "same\nnew\nsame\nold\n")).toEqual({
      kind: "requires-overwrite",
      reason: "removed pattern is not unique in remote markdown"
    });
  });

  it("requires overwrite for multiple changed regions", () => {
    expect(planMarkdownWrite("a\nold-1\nb\nold-2\nc\n", "a\nnew-1\nb\nnew-2\nc\n")).toEqual({
      kind: "requires-overwrite",
      reason: "diff has multiple changed regions"
    });
  });
});
