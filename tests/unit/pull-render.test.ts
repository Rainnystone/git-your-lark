import { describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  cleanMarkdownFilename,
  renderPullIndexMarkdown,
  renderPullMarkdown
} from "../../scripts/lib/pull-render.js";
import type { PullRemoteDocument, PullRemoteIndex } from "../../scripts/lib/pull-types.js";

function remoteDocument(overrides: Partial<PullRemoteDocument> = {}): PullRemoteDocument {
  return {
    sourceKind: "doc",
    title: "Remote",
    docToken: "doc_remote",
    remotePath: "Root/Remote",
    ...overrides
  };
}

function remoteIndex(overrides: Partial<PullRemoteIndex> = {}): PullRemoteIndex {
  return {
    title: "Root",
    docToken: "doc_root",
    remotePath: "Root",
    childDocTokens: [],
    ...overrides
  };
}

describe("renderPullMarkdown", () => {
  it("converts fetched title tags to markdown headings and writes gyl frontmatter", () => {
    const rendered = renderPullMarkdown({
      markdown: "<title>Remote</title>\n\nBody\n",
      remote: remoteDocument({
        wikiNodeToken: "wiki_remote",
        sourceUrl: "https://example.feishu.cn/wiki/wiki_remote"
      }),
      plannedPath: "Root/Remote.md",
      index: new Map(),
      mediaPlans: [],
      pulledAt: "2026-06-22T00:00:00.000Z"
    });

    expect(rendered.markdown).toBe(
      [
        "---",
        "gyl:",
        "  source: lark",
        '  token: "doc_remote"',
        '  wiki_node_token: "wiki_remote"',
        '  url: "https://example.feishu.cn/wiki/wiki_remote"',
        '  title: "Remote"',
        '  pulled_at: "2026-06-22T00:00:00.000Z"',
        "---",
        "",
        "# Remote",
        "",
        "Body",
        ""
      ].join("\n")
    );
  });

  it("rewrites image stream URLs and source tags to local assets", () => {
    const streamImageUrl = "https://internal-api-drive-stream.feishu.cn/space/api/box/stream/img_token";
    const streamFileUrl = "https://internal-api-drive-stream.feishu.cn/space/api/box/stream/file_token";

    const rendered = renderPullMarkdown({
      markdown: [
        "# Remote",
        `![A](${streamImageUrl})`,
        `<figure><source name="source.md" href="${streamFileUrl}" token="file_token"/></figure>`,
        ""
      ].join("\n"),
      remote: remoteDocument(),
      plannedPath: "Root/Remote.md",
      index: new Map(),
      mediaPlans: [
        {
          kind: "image",
          name: "A.png",
          alt: "A",
          sourceToken: "img_token",
          sourceHref: streamImageUrl,
          localPath: "assets/Remote/A.png"
        },
        {
          kind: "file",
          name: "source.md",
          alt: "",
          sourceToken: "file_token",
          sourceHref: streamFileUrl,
          localPath: "assets/Remote/source.md"
        }
      ],
      pulledAt: "2026-06-22T00:00:00.000Z"
    });

    expect(rendered.markdown).toContain("![A](assets/Remote/A.png)");
    expect(rendered.markdown).toContain("[附件](assets/Remote/source.md)");
    expect(rendered.markdown).not.toContain("internal-api-drive-stream.feishu.cn");
  });

  it("treats source url attributes as downloadable media matches", () => {
    const streamFileUrl = "https://internal-api-drive-stream.feishu.cn/space/api/box/stream/file_token";

    const rendered = renderPullMarkdown({
      markdown: [
        "# Remote",
        `<figure><source name="source.md" url="${streamFileUrl}"/></figure>`,
        ""
      ].join("\n"),
      remote: remoteDocument(),
      plannedPath: "Root/Remote.md",
      index: new Map(),
      mediaPlans: [
        {
          kind: "file",
          name: "source.md",
          alt: "",
          sourceHref: streamFileUrl,
          localPath: "assets/Remote/source.md"
        }
      ],
      pulledAt: "2026-06-22T00:00:00.000Z"
    });

    expect(rendered.markdown).toContain("[附件](assets/Remote/source.md)");
    expect(rendered.markdown).not.toContain("internal-api-drive-stream.feishu.cn");
  });

  it("treats source token and URL aliases as downloadable media matches", () => {
    const streamFileUrl = "https://stream/file";

    const rendered = renderPullMarkdown({
      markdown: `<figure><source file_token="file_token" file_url="${streamFileUrl}"/></figure>`,
      remote: remoteDocument(),
      plannedPath: "Root/Remote.md",
      index: new Map(),
      mediaPlans: [
        {
          kind: "file",
          name: "source.md",
          alt: "",
          sourceToken: "file_token",
          sourceHref: streamFileUrl,
          localPath: "assets/Remote/source.md"
        }
      ],
      pulledAt: "2026-06-22T00:00:00.000Z"
    });

    expect(rendered.markdown).toContain("[附件](assets/Remote/source.md)");
  });

  it("renders unavailable source tags as visible attachment placeholders", () => {
    const rendered = renderPullMarkdown({
      markdown: '<figure><source name="source.md" href="https://stream/file" token="file_token"/></figure>',
      remote: remoteDocument(),
      plannedPath: "Root/Remote.md",
      index: new Map(),
      mediaPlans: [],
      pulledAt: "2026-06-22T00:00:00.000Z"
    });

    expect(rendered.markdown).toContain("[附件未下载: source.md]");
  });

  it("writes YAML-safe frontmatter for values with special characters", () => {
    const rendered = renderPullMarkdown({
      markdown: "Body only",
      remote: remoteDocument({
        title: 'A: B # [C] "D"\nE',
        sourceUrl: 'https://example.feishu.cn/wiki/wiki_remote?label=A: B # [C] "D"'
      }),
      plannedPath: "Root/Remote.md",
      index: new Map(),
      mediaPlans: [],
      pulledAt: "2026-06-22T00:00:00.000Z"
    });
    const frontmatter = rendered.markdown.slice(4, rendered.markdown.indexOf("\n---", 4));

    const parsed = YAML.parse(frontmatter) as { gyl: Record<string, unknown> };

    expect(parsed.gyl.title).toBe('A: B # [C] "D"\nE');
    expect(parsed.gyl.url).toBe('https://example.feishu.cn/wiki/wiki_remote?label=A: B # [C] "D"');
    expect(parsed.gyl.token).toBe("doc_remote");
  });

  it("adds the remote title as an H1 when fetched markdown has no title heading", () => {
    const rendered = renderPullMarkdown({
      markdown: "Body only",
      remote: remoteDocument({ title: "Remote" }),
      plannedPath: "Root/Remote.md",
      index: new Map(),
      mediaPlans: [],
      pulledAt: "2026-06-22T00:00:00.000Z"
    });

    expect(rendered.markdown).toContain("\n# Remote\n\nBody only\n");
  });

  it("does not duplicate an existing H1 heading", () => {
    const rendered = renderPullMarkdown({
      markdown: "# Existing\n\nBody",
      remote: remoteDocument({ title: "Remote" }),
      plannedPath: "Root/Remote.md",
      index: new Map(),
      mediaPlans: [],
      pulledAt: "2026-06-22T00:00:00.000Z"
    });

    expect(rendered.markdown.match(/^# /gm)).toHaveLength(1);
    expect(rendered.markdown).toContain("\n# Existing\n\nBody\n");
  });

  it("converts import-set Lark URLs and cite tags while preserving code", () => {
    const rendered = renderPullMarkdown({
      markdown: [
        "# A",
        "See [B](https://example.feishu.cn/wiki/wiki_b).",
        'Also <cite type="doc" doc-id="doc_b"></cite>.',
        'Self <cite type="doc" doc-id="doc_b"/>.',
        "`https://example.feishu.cn/wiki/wiki_b`",
        "```",
        "https://example.feishu.cn/wiki/wiki_b",
        "```",
        ""
      ].join("\n"),
      remote: remoteDocument({ title: "A", docToken: "doc_a", remotePath: "Root/A" }),
      plannedPath: "Root/A.md",
      index: new Map([
        ["wiki_b", { stem: "B", localPath: "Root/B.md" }],
        ["doc_b", { stem: "B", localPath: "Root/B.md" }]
      ]),
      mediaPlans: []
    });

    expect(rendered.markdown).toContain("See [[B]].");
    expect(rendered.markdown).toContain("Also [[B]].");
    expect(rendered.markdown).toContain("Self [[B]].");
    expect(rendered.markdown).toContain("`https://example.feishu.cn/wiki/wiki_b`");
    expect(rendered.markdown).toContain("```\nhttps://example.feishu.cn/wiki/wiki_b\n```");
  });

  it("renders duplicate-stem Lark references as path wiki links with readable labels", () => {
    const rendered = renderPullMarkdown({
      markdown: [
        "# A",
        "See [B](https://example.feishu.cn/wiki/wiki_b).",
        'Also <cite type="doc" doc-id="doc_b"></cite>.',
        ""
      ].join("\n"),
      remote: remoteDocument({ title: "A", docToken: "doc_a", remotePath: "Root/A" }),
      plannedPath: "Root/A.md",
      index: new Map([
        ["wiki_b", { stem: "B", localPath: "Root/Section/B.md", wikiTarget: "Root/Section/B" }],
        ["doc_b", { stem: "B", localPath: "Root/Section/B.md", wikiTarget: "Root/Section/B" }]
      ]),
      mediaPlans: [],
      pulledAt: "2026-06-22T00:00:00.000Z"
    });

    expect(rendered.markdown).toContain("See [[Root/Section/B|B]].");
    expect(rendered.markdown).toContain("Also [[Root/Section/B|B]].");
  });

  it("converts import-set larksuite URLs to wiki links", () => {
    const rendered = renderPullMarkdown({
      markdown: "See [B](https://example.larksuite.com/wiki/wiki_b).",
      remote: remoteDocument({ title: "A", docToken: "doc_a", remotePath: "Root/A" }),
      plannedPath: "Root/A.md",
      index: new Map([["wiki_b", { stem: "B", localPath: "Root/B.md" }]]),
      mediaPlans: [],
      pulledAt: "2026-06-22T00:00:00.000Z"
    });

    expect(rendered.markdown).toContain("See [[B]].");
  });

  it("converts bare import-set Lark URLs outside code only", () => {
    const rendered = renderPullMarkdown({
      markdown: [
        "See https://example.larksuite.com/wiki/wiki_b now.",
        "`https://example.larksuite.com/wiki/wiki_b`",
        "```",
        "https://example.larksuite.com/wiki/wiki_b",
        "```",
        "    https://example.larksuite.com/wiki/wiki_b",
        "Keep https://example.com/wiki/wiki_b unchanged.",
        ""
      ].join("\n"),
      remote: remoteDocument({ title: "A", docToken: "doc_a", remotePath: "Root/A" }),
      plannedPath: "Root/A.md",
      index: new Map([["wiki_b", { stem: "B", localPath: "Root/B.md" }]]),
      mediaPlans: [],
      pulledAt: "2026-06-22T00:00:00.000Z"
    });

    expect(rendered.markdown).toContain("See [[B]] now.");
    expect(rendered.markdown).toContain("`https://example.larksuite.com/wiki/wiki_b`");
    expect(rendered.markdown).toContain("```\nhttps://example.larksuite.com/wiki/wiki_b\n```");
    expect(rendered.markdown).toContain("    https://example.larksuite.com/wiki/wiki_b");
    expect(rendered.markdown).toContain("Keep https://example.com/wiki/wiki_b unchanged.");
  });
});

describe("renderPullIndexMarkdown", () => {
  it("writes gyl frontmatter and links child documents", () => {
    const markdown = renderPullIndexMarkdown({
      remote: remoteIndex({
        wikiNodeToken: "wiki_root",
        sourceUrl: "https://example.feishu.cn/wiki/wiki_root",
        childDocTokens: ["doc_a"]
      }),
      plannedPath: "Root.md",
      index: new Map([["doc_a", { stem: "A", localPath: "Root/A.md" }]]),
      pulledAt: "2026-06-22T00:00:00.000Z"
    });

    expect(markdown).toBe(
      [
        "---",
        "gyl:",
        "  source: lark",
        '  token: "doc_root"',
        '  wiki_node_token: "wiki_root"',
        '  url: "https://example.feishu.cn/wiki/wiki_root"',
        '  title: "Root"',
        '  pulled_at: "2026-06-22T00:00:00.000Z"',
        "---",
        "",
        "# Root",
        "",
        "- [[A]]",
        ""
      ].join("\n")
    );
  });

  it("uses path wiki links for duplicate child note names", () => {
    const markdown = renderPullIndexMarkdown({
      remote: remoteIndex({
        childDocTokens: ["doc_a", "doc_b"]
      }),
      plannedPath: "Root.md",
      index: new Map([
        ["doc_a", { stem: "Same", localPath: "Root/A/Same.md", wikiTarget: "Root/A/Same" }],
        ["doc_b", { stem: "Same", localPath: "Root/B/Same.md", wikiTarget: "Root/B/Same" }]
      ]),
      pulledAt: "2026-06-22T00:00:00.000Z"
    });

    expect(markdown).toContain("- [[Root/A/Same|Same]]");
    expect(markdown).toContain("- [[Root/B/Same|Same]]");
  });
});

describe("cleanMarkdownFilename", () => {
  it("replaces invalid filename characters and falls back for empty names", () => {
    expect(cleanMarkdownFilename('A/B\\C:D*E?F"G<H>I|')).toBe("A_B_C_D_E_F_G_H_I_");
    expect(cleanMarkdownFilename("Name. ")).toBe("Name");
    expect(cleanMarkdownFilename(" . ")).toBe("untitled");
  });
});
