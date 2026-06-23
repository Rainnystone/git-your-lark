import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { verifyPullWorkspace } from "../../scripts/lib/pull-verify.js";
import type { GitYourLarkRootState, PullDocumentState } from "../../scripts/lib/state.js";

describe("verifyPullWorkspace", () => {
  it("passes a valid pulled document with gyl frontmatter and existing assets", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-pull-verify-valid-"));
    await writePulledMarkdown(workspaceRoot, {
      body: "![Diagram](assets/故事块理论文献/image.webp)\n"
    });
    await writeWorkspaceFile(workspaceRoot, "参考资料/assets/故事块理论文献/image.webp", "asset");

    const verified = await verifyPullWorkspace({
      workspaceRoot,
      state: rootState({
        documents: {
          "参考资料/故事块理论文献.md": pullDocumentState({
            assetPaths: ["参考资料/assets/故事块理论文献/image.webp"]
          })
        }
      })
    });

    expect(verified).toEqual({
      ok: true,
      problems: [],
      checkedFiles: ["参考资料/故事块理论文献.md"],
      checkedAssets: ["参考资料/assets/故事块理论文献/image.webp"]
    });
  });

  it("reports a missing Markdown file from pull state", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-pull-verify-missing-md-"));

    const verified = await verifyPullWorkspace({
      workspaceRoot,
      state: rootState({
        documents: {
          "参考资料/故事块理论文献.md": pullDocumentState()
        }
      })
    });

    expect(verified.ok).toBe(false);
    expect(verified.problems).toEqual([
      "Missing pulled Markdown file: 参考资料/故事块理论文献.md"
    ]);
    expect(verified.checkedFiles).toEqual(["参考资料/故事块理论文献.md"]);
  });

  it("reports a state document path that escapes the workspace without throwing", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-pull-verify-escaping-md-"));
    await writePulledMarkdown(workspaceRoot, {
      body: "Body.\n"
    });

    const verified = await verifyPullWorkspace({
      workspaceRoot,
      state: rootState({
        documents: {
          "../outside.md": pullDocumentState({
            localPath: "../outside.md"
          }),
          "参考资料/故事块理论文献.md": pullDocumentState()
        }
      })
    });

    expect(verified.ok).toBe(false);
    expect(verified.problems).toContain("Path escapes the workspace root: ../outside.md");
    expect(verified.checkedFiles).toContain("../outside.md");
    expect(verified.checkedFiles).toContain("参考资料/故事块理论文献.md");
  });

  it("reports a missing local asset referenced by generated Markdown", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-pull-verify-missing-asset-"));
    await writePulledMarkdown(workspaceRoot, {
      body: "![Diagram](assets/故事块理论文献/image.webp)\n"
    });

    const verified = await verifyPullWorkspace({
      workspaceRoot,
      state: rootState({
        documents: {
          "参考资料/故事块理论文献.md": pullDocumentState()
        }
      })
    });

    expect(verified.ok).toBe(false);
    expect(verified.problems).toEqual([
      "Missing local asset referenced by 参考资料/故事块理论文献.md: 参考资料/assets/故事块理论文献/image.webp"
    ]);
    expect(verified.checkedAssets).toEqual(["参考资料/assets/故事块理论文献/image.webp"]);
  });

  it("reports a Markdown image path that escapes the workspace without throwing", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-pull-verify-escaping-image-"));
    await writePulledMarkdown(workspaceRoot, {
      body: "![x](../../outside.png)\n"
    });

    const verified = await verifyPullWorkspace({
      workspaceRoot,
      state: rootState({
        documents: {
          "参考资料/故事块理论文献.md": pullDocumentState()
        }
      })
    });

    expect(verified.ok).toBe(false);
    expect(verified.problems).toContain("Path escapes the workspace root: 参考资料/../../outside.png");
    expect(verified.checkedAssets).toContain("参考资料/../../outside.png");
  });

  it("reports a missing regular local file link referenced by generated Markdown", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-pull-verify-missing-local-link-"));
    await writePulledMarkdown(workspaceRoot, {
      body: "[附件](assets/故事块理论文献/source.pdf)\n"
    });

    const verified = await verifyPullWorkspace({
      workspaceRoot,
      state: rootState({
        documents: {
          "参考资料/故事块理论文献.md": pullDocumentState()
        }
      })
    });

    expect(verified.ok).toBe(false);
    expect(verified.problems).toEqual([
      "Missing local asset referenced by 参考资料/故事块理论文献.md: 参考资料/assets/故事块理论文献/source.pdf"
    ]);
    expect(verified.checkedAssets).toEqual(["参考资料/assets/故事块理论文献/source.pdf"]);
  });

  it("ignores regular external file links in generated Markdown", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-pull-verify-external-link-"));
    await writePulledMarkdown(workspaceRoot, {
      body: "[附件](https://example.com/file.pdf)\n"
    });

    const verified = await verifyPullWorkspace({
      workspaceRoot,
      state: rootState({
        documents: {
          "参考资料/故事块理论文献.md": pullDocumentState()
        }
      })
    });

    expect(verified).toEqual({
      ok: true,
      problems: [],
      checkedFiles: ["参考资料/故事块理论文献.md"],
      checkedAssets: []
    });
  });

  it("reports a missing regular local file link with spaces and parentheses", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-pull-verify-local-link-spaces-"));
    await writePulledMarkdown(workspaceRoot, {
      body: "[附件](assets/故事块理论文献/source file (draft).pdf)\n"
    });

    const verified = await verifyPullWorkspace({
      workspaceRoot,
      state: rootState({
        documents: {
          "参考资料/故事块理论文献.md": pullDocumentState()
        }
      })
    });

    expect(verified.ok).toBe(false);
    expect(verified.problems).toEqual([
      "Missing local asset referenced by 参考资料/故事块理论文献.md: 参考资料/assets/故事块理论文献/source file (draft).pdf"
    ]);
    expect(verified.checkedAssets).toEqual(["参考资料/assets/故事块理论文献/source file (draft).pdf"]);
  });

  it("reports generated Markdown that still contains a Feishu stream URL", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-pull-verify-stream-url-"));
    await writePulledMarkdown(workspaceRoot, {
      body: "![Diagram](https://internal-api-drive-stream.feishu.cn/space/api/box/stream/img_token)\n"
    });

    const verified = await verifyPullWorkspace({
      workspaceRoot,
      state: rootState({
        documents: {
          "参考资料/故事块理论文献.md": pullDocumentState()
        }
      })
    });

    expect(verified.ok).toBe(false);
    expect(verified.problems).toEqual([
      "Generated Markdown contains unreplaced Feishu stream URL: 参考资料/故事块理论文献.md"
    ]);
  });

  it("reports collection wiki links that point outside known pulled stems", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-pull-verify-wiki-link-"));
    await writePulledMarkdown(workspaceRoot, {
      body: "See [[未知文档|label]].\n"
    });

    const verified = await verifyPullWorkspace({
      workspaceRoot,
      state: rootState({
        sources: {
          wiki_parent: {
            type: "wiki_node",
            tokenOrUrl: "wiki_parent"
          }
        },
        documents: {
          "参考资料/故事块理论文献.md": pullDocumentState()
        }
      })
    });

    expect(verified.ok).toBe(false);
    expect(verified.problems).toEqual([
      "Wiki link in pulled collection points outside known pulled documents: 参考资料/故事块理论文献.md -> 未知文档"
    ]);
  });

  it.each([
    ["gyl.token", ["  title: \"故事块理论文献\"", "  pulled_at: \"2026-06-23T00:00:00.000Z\""]],
    ["gyl.title", ["  token: \"doc_theory\"", "  pulled_at: \"2026-06-23T00:00:00.000Z\""]],
    ["gyl.pulled_at", ["  token: \"doc_theory\"", "  title: \"故事块理论文献\""]]
  ])("reports missing required %s frontmatter", async (field, gylLines) => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-pull-verify-frontmatter-"));
    await writeWorkspaceFile(
      workspaceRoot,
      "参考资料/故事块理论文献.md",
      [
        "---",
        "gyl:",
        ...gylLines,
        "---",
        "",
        "# 故事块理论文献",
        ""
      ].join("\n")
    );

    const verified = await verifyPullWorkspace({
      workspaceRoot,
      state: rootState({
        documents: {
          "参考资料/故事块理论文献.md": pullDocumentState()
        }
      })
    });

    expect(verified.ok).toBe(false);
    expect(verified.problems).toEqual([
      `Missing required ${field} frontmatter in pulled Markdown: 参考资料/故事块理论文献.md`
    ]);
  });
});

async function writePulledMarkdown(workspaceRoot: string, input: { body: string }): Promise<void> {
  await writeWorkspaceFile(
    workspaceRoot,
    "参考资料/故事块理论文献.md",
    [
      "---",
      "gyl:",
      "  token: \"doc_theory\"",
      "  title: \"故事块理论文献\"",
      "  pulled_at: \"2026-06-23T00:00:00.000Z\"",
      "---",
      "",
      "# 故事块理论文献",
      "",
      input.body
    ].join("\n")
  );
}

async function writeWorkspaceFile(workspaceRoot: string, localPath: string, contents: string): Promise<void> {
  const absolutePath = join(workspaceRoot, ...localPath.split("/"));
  await mkdir(join(absolutePath, ".."), { recursive: true });
  await writeFile(absolutePath, contents, "utf8");
}

function rootState(input: Partial<GitYourLarkRootState["pull"]> = {}): GitYourLarkRootState {
  return {
    version: 2,
    publish: {
      version: 1,
      remoteFolderToken: "fld_publish",
      documents: {},
      attachments: {}
    },
    pull: {
      sources: {},
      documents: {},
      assets: {},
      ...input
    }
  };
}

function pullDocumentState(input: Partial<PullDocumentState> = {}): PullDocumentState {
  return {
    docToken: "doc_theory",
    wikiNodeToken: "wiki_theory",
    sourceUrl: "https://example.feishu.cn/wiki/wiki_theory",
    remoteTitle: "故事块理论文献",
    remotePath: "参考资料/故事块理论文献",
    localPath: "参考资料/故事块理论文献.md",
    remoteRevision: "rev_1",
    localHash: "hash",
    assetPaths: [],
    ...input
  };
}
