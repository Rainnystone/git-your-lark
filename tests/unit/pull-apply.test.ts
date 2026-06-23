import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyPullProposal, type ApplyPullOptions } from "../../scripts/lib/pull-apply.js";
import { sha256Buffer, sha256Text } from "../../scripts/lib/hash.js";
import type { CommandResult } from "../../scripts/lib/lark-cli.js";
import type { PullProposal } from "../../scripts/lib/pull-proposal.js";
import type { GitYourLarkRootState, PullAssetState, PullDocumentState } from "../../scripts/lib/state.js";

type ApplyRun = NonNullable<ApplyPullOptions["run"]>;

const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
});

describe("applyPullProposal", () => {
  it("refuses proposals with blockers before fetching, loading state, or writing", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-pull-apply-blocked-"));
    const configPath = await writeConfig(workspaceRoot);
    const proposalPath = await writeProposal(
      workspaceRoot,
      proposal({
        blockers: ["Existing local file is not owned by pull state: 参考资料/故事块理论文献.md"],
        files: [plannedDocument()]
      })
    );
    const run = vi.fn<ApplyRun>(async () => result());
    const loadRootState = vi.fn<NonNullable<ApplyPullOptions["loadRootState"]>>(async () => rootState());
    const saveRootState = vi.fn<NonNullable<ApplyPullOptions["saveRootState"]>>(async () => undefined);

    const applied = await applyPullProposal({
      proposalPath,
      configPath,
      run,
      loadRootState,
      saveRootState
    });

    expect(applied).toEqual({
      ok: false,
      status: "blocked",
      problems: ["Existing local file is not owned by pull state: 参考资料/故事块理论文献.md"],
      writtenFiles: [],
      writtenAssets: []
    });
    expect(run).not.toHaveBeenCalled();
    expect(loadRootState).not.toHaveBeenCalled();
    expect(saveRootState).not.toHaveBeenCalled();
    expect(existsSync(join(workspaceRoot, "参考资料", "故事块理论文献.md"))).toBe(false);
  });

  it("re-fetches each planned document and refuses when revision_id differs from the proposal", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-pull-apply-revision-"));
    const configPath = await writeConfig(workspaceRoot);
    const proposalPath = await writeProposal(
      workspaceRoot,
      proposal({
        files: [plannedDocument({ expectedRevisionId: "rev_1" })]
      })
    );
    const calls: Array<{ command: string; args: string[] }> = [];
    const run = vi.fn<ApplyRun>(async (command, args) => {
      calls.push({ command, args });
      return fetchResult(args, { revisionId: "rev_2" });
    });

    const applied = await applyPullProposal({
      proposalPath,
      configPath,
      run,
      loadRootState: async () => rootState()
    });

    expect(applied.ok).toBe(false);
    expect(applied.status).toBe("conflict");
    expect(applied.problems).toEqual([
      "Remote document changed since proposal for 参考资料/故事块理论文献.md: expected revision rev_1, found rev_2"
    ]);
    expect(calls.map((call) => call.args)).toEqual([
      [
        "docs",
        "+fetch",
        "--api-version",
        "v2",
        "--doc",
        "doc_theory",
        "--doc-format",
        "markdown",
        "--as",
        "user",
        "--format",
        "json"
      ],
      [
        "docs",
        "+fetch",
        "--api-version",
        "v2",
        "--doc",
        "doc_theory",
        "--doc-format",
        "xml",
        "--detail",
        "full",
        "--as",
        "user",
        "--format",
        "json"
      ]
    ]);
    expect(existsSync(join(workspaceRoot, "参考资料", "故事块理论文献.md"))).toBe(false);
  });

  it("refuses to overwrite an existing unowned file", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-pull-apply-unowned-"));
    const configPath = await writeConfig(workspaceRoot);
    await mkdir(join(workspaceRoot, "参考资料"), { recursive: true });
    await writeFile(join(workspaceRoot, "参考资料", "故事块理论文献.md"), "local notes\n", "utf8");
    const proposalPath = await writeProposal(
      workspaceRoot,
      proposal({
        files: [plannedDocument()]
      })
    );
    const run = vi.fn<ApplyRun>(async () => result());

    const applied = await applyPullProposal({
      proposalPath,
      configPath,
      run,
      loadRootState: async () => rootState()
    });

    expect(applied).toMatchObject({ ok: false, status: "conflict" });
    expect(applied.problems).toEqual([
      "Existing local file is not owned by pull state: 参考资料/故事块理论文献.md"
    ]);
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects a planned file under a symlinked workspace directory that resolves outside the workspace", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-pull-apply-symlink-workspace-"));
    const externalRoot = await mkdtemp(join(tmpdir(), "gyl-pull-apply-external-"));
    const linkedDir = join(workspaceRoot, "linked-dir");
    await symlink(externalRoot, linkedDir, "dir");
    const configPath = await writeConfig(workspaceRoot);
    const proposalPath = await writeProposal(
      workspaceRoot,
      proposal({
        files: [plannedDocument({ localPath: "linked-dir/doc.md" })]
      })
    );
    const run = vi.fn<ApplyRun>(async (_command, args) => fetchResult(args, { revisionId: "rev_1" }));
    const saveRootState = vi.fn<NonNullable<ApplyPullOptions["saveRootState"]>>(async () => undefined);

    const applied = await applyPullProposal({
      proposalPath,
      configPath,
      run,
      loadRootState: async () => rootState(),
      saveRootState
    });

    expect(applied).toMatchObject({ ok: false, status: "failed" });
    expect(applied.problems[0]).toContain("escapes the workspace root");
    expect(existsSync(join(externalRoot, "doc.md"))).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(saveRootState).not.toHaveBeenCalled();
  });

  it("rejects proposals whose source does not match the current pull config before fetching, loading state, or writing", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-pull-apply-source-mismatch-"));
    const configPath = await writeConfig(workspaceRoot);
    const proposalPath = await writeProposal(
      workspaceRoot,
      proposal({
        source: { type: "wiki_node", tokenOrUrl: "other_wiki_parent", title: "Other" },
        files: [plannedDocument()]
      })
    );
    const run = vi.fn<ApplyRun>(async () => result());
    const loadRootState = vi.fn<NonNullable<ApplyPullOptions["loadRootState"]>>(async () => rootState());
    const saveRootState = vi.fn<NonNullable<ApplyPullOptions["saveRootState"]>>(async () => undefined);

    const applied = await applyPullProposal({
      proposalPath,
      configPath,
      run,
      loadRootState,
      saveRootState
    });

    expect(applied).toEqual({
      ok: false,
      status: "blocked",
      problems: [
        "Pull proposal source does not match current config: expected wiki_node wiki_parent, found wiki_node other_wiki_parent"
      ],
      writtenFiles: [],
      writtenAssets: []
    });
    expect(run).not.toHaveBeenCalled();
    expect(loadRootState).not.toHaveBeenCalled();
    expect(saveRootState).not.toHaveBeenCalled();
    expect(existsSync(join(workspaceRoot, "参考资料", "故事块理论文献.md"))).toBe(false);
  });

  it("refuses to update a pull-owned file when current local hash differs from expectedLocalHash", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-pull-apply-local-change-"));
    const configPath = await writeConfig(workspaceRoot);
    const originalMarkdown = "old imported markdown\n";
    const originalHash = sha256Text(originalMarkdown);
    await mkdir(join(workspaceRoot, "参考资料"), { recursive: true });
    await writeFile(join(workspaceRoot, "参考资料", "故事块理论文献.md"), "edited locally\n", "utf8");
    const proposalPath = await writeProposal(
      workspaceRoot,
      proposal({
        files: [plannedDocument({ expectedLocalHash: originalHash })]
      })
    );
    const run = vi.fn<ApplyRun>(async () => result());

    const applied = await applyPullProposal({
      proposalPath,
      configPath,
      run,
      loadRootState: async () =>
        rootState({
          documents: {
            "参考资料/故事块理论文献.md": pullDocumentState({
              localHash: originalHash
            })
          }
        })
    });

    expect(applied).toMatchObject({ ok: false, status: "conflict" });
    expect(applied.problems).toEqual([
      "Existing pull-owned file has local changes since proposal: 参考资料/故事块理论文献.md"
    ]);
    expect(run).not.toHaveBeenCalled();
  });

  it("writes Markdown files and assets, then updates pull document and asset state", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-pull-apply-write-"));
    const configPath = await writeConfig(workspaceRoot);
    const proposalPath = await writeProposal(
      workspaceRoot,
      proposal({
        files: [plannedIndex(), plannedDocument({ title: "旧标题", expectedRevisionId: "rev_1" })],
        assets: [plannedAsset()]
      })
    );
    const run = vi.fn<ApplyRun>(async (_command, args, cwd) => {
      if (args.includes("+media-download")) {
        await writeFile(join(cwd ?? workspaceRoot, args[args.indexOf("--output") + 1]), "asset bytes");
        return result();
      }
      return fetchResult(args, { revisionId: "rev_1" });
    });
    const saved: GitYourLarkRootState[] = [];

    const applied = await applyPullProposal({
      proposalPath,
      configPath,
      run,
      loadRootState: async () => rootState(),
      saveRootState: async (_path, state) => {
        saved.push(state);
      },
      now: () => new Date("2026-06-23T00:00:00.000Z")
    });

    expect(applied).toMatchObject({
      ok: true,
      status: "applied",
      problems: [],
      writtenFiles: ["参考资料/参考资料.md", "参考资料/故事块理论文献.md"],
      writtenAssets: ["参考资料/assets/故事块理论文献/image.webp"]
    });
    await expect(readFile(join(workspaceRoot, "参考资料", "故事块理论文献.md"), "utf8")).resolves.toContain(
      "![A](assets/故事块理论文献/image.webp)"
    );
    await expect(readFile(join(workspaceRoot, "参考资料", "参考资料.md"), "utf8")).resolves.toContain("- [[故事块理论文献]]");
    await expect(readFile(join(workspaceRoot, "参考资料", "assets", "故事块理论文献", "image.webp"), "utf8")).resolves.toBe(
      "asset bytes"
    );
    expect(saved).toHaveLength(1);
    expect(saved[0].pull.documents["参考资料/故事块理论文献.md"]).toMatchObject({
      docToken: "doc_theory",
      wikiNodeToken: "wiki_theory",
      sourceUrl: "https://example.feishu.cn/wiki/wiki_theory",
      remoteTitle: "故事块理论文献",
      remotePath: "参考资料/故事块理论文献",
      localPath: "参考资料/故事块理论文献.md",
      remoteRevision: "rev_1",
      assetPaths: ["参考资料/assets/故事块理论文献/image.webp"]
    });
    expect(saved[0].pull.documents["参考资料/故事块理论文献.md"].localHash).toEqual(expect.any(String));
    expect(saved[0].pull.assets["参考资料/assets/故事块理论文献/image.webp"]).toEqual({
      sourceToken: "img_token",
      sourceUrl: "https://stream/image",
      localPath: "参考资料/assets/故事块理论文献/image.webp",
      ownerDocToken: "doc_theory",
      hash: sha256Text("asset bytes")
    });
    expect(saved[0].pull.sources["wiki_node:wiki_parent"]).toEqual({
      type: "wiki_node",
      tokenOrUrl: "wiki_parent",
      remoteTitle: "参考资料",
      lastPulledAt: "2026-06-23T00:00:00.000Z"
    });
  });

  it("renders index Markdown from proposal childDocTokens instead of remotePath prefix inference", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-pull-apply-index-children-"));
    const configPath = await writeConfig(workspaceRoot);
    const proposalPath = await writeProposal(
      workspaceRoot,
      proposal({
        files: [
          plannedIndex({ childDocTokens: ["doc_direct"] }),
          plannedDocument({
            title: "直接文档",
            docToken: "doc_direct",
            wikiNodeToken: "wiki_direct",
            remotePath: "参考资料/直接文档",
            localPath: "参考资料/直接文档.md"
          }),
          plannedDocument({
            title: "嵌套文档",
            docToken: "doc_nested",
            wikiNodeToken: "wiki_nested",
            remotePath: "参考资料/子目录/嵌套文档",
            localPath: "参考资料/子目录/嵌套文档.md"
          })
        ]
      })
    );
    const run = vi.fn<ApplyRun>(async () => fetchResult([], { revisionId: "rev_1" }));

    const applied = await applyPullProposal({
      proposalPath,
      configPath,
      run,
      loadRootState: async () => rootState(),
      saveRootState: async () => undefined,
      now: () => new Date("2026-06-23T00:00:00.000Z")
    });

    expect(applied).toMatchObject({ ok: true, status: "applied" });
    const indexMarkdown = await readFile(join(workspaceRoot, "参考资料", "参考资料.md"), "utf8");
    expect(indexMarkdown).toContain("- [[直接文档]]");
    expect(indexMarkdown).not.toContain("- [[嵌套文档]]");
  });

  it("downloads assets through lark-cli media-download when sourceToken exists", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-pull-apply-token-asset-"));
    const configPath = await writeConfig(workspaceRoot);
    const proposalPath = await writeProposal(
      workspaceRoot,
      proposal({
        files: [],
        assets: [plannedAsset()]
      })
    );
    const calls: Array<{ args: string[]; cwd?: string }> = [];
    const run = vi.fn<ApplyRun>(async (_command, args, cwd) => {
      calls.push({ args, cwd });
      await writeFile(join(cwd ?? workspaceRoot, args[args.indexOf("--output") + 1]), "downloaded");
      return result();
    });

    const applied = await applyPullProposal({
      proposalPath,
      configPath,
      run,
      loadRootState: async () => rootState(),
      saveRootState: async () => undefined
    });

    expect(applied).toMatchObject({ ok: true, status: "applied" });
    expect(calls[0].args.slice(0, -1)).toEqual([
      "docs",
      "+media-download",
      "--as",
      "user",
      "--token",
      "img_token",
      "--output"
    ]);
    expect(calls[0].args.at(-1)).toMatch(
      /^\.git-your-lark\/apply-staging\/pull-proposal-test-\d+\/参考资料\/assets\/故事块理论文献\/image\.webp$/
    );
    expect(calls[0].cwd).toBe(workspaceRoot);
    expect(globalThis.fetch).toBe(originalFetch);
  });

  it("does not overwrite an existing pull-owned asset when a later asset download fails during staging", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-pull-apply-asset-staging-fail-"));
    const configPath = await writeConfig(workspaceRoot);
    const originalAsset = Buffer.from("original asset");
    const originalAssetHash = sha256Buffer(originalAsset);
    const existingAssetPath = join(workspaceRoot, "参考资料", "assets", "故事块理论文献", "image.webp");
    await mkdir(join(workspaceRoot, "参考资料", "assets", "故事块理论文献"), { recursive: true });
    await writeFile(existingAssetPath, originalAsset);
    const proposalPath = await writeProposal(
      workspaceRoot,
      proposal({
        files: [],
        assets: [
          plannedAsset({ expectedLocalHash: originalAssetHash }),
          plannedAsset({
            name: "image-2.webp",
            sourceToken: "img_token_2",
            sourceHref: "https://stream/image-2",
            localPath: "参考资料/assets/故事块理论文献/image-2.webp"
          })
        ]
      })
    );
    const run = vi.fn<ApplyRun>(async (_command, args, cwd) => {
      if (args.includes("img_token_2")) {
        return result({ code: 1, stderr: "download failed" });
      }
      await writeFile(join(cwd ?? workspaceRoot, args[args.indexOf("--output") + 1]), "new asset");
      return result();
    });

    const applied = await applyPullProposal({
      proposalPath,
      configPath,
      run,
      loadRootState: async () =>
        rootState({
          assets: {
            "参考资料/assets/故事块理论文献/image.webp": pullAssetState({
              hash: originalAssetHash
            })
          }
        }),
      saveRootState: async () => undefined
    });

    expect(applied).toMatchObject({ ok: false, status: "failed" });
    await expect(readFile(existingAssetPath)).resolves.toEqual(originalAsset);
    expect(existsSync(join(workspaceRoot, "参考资料", "assets", "故事块理论文献", "image-2.webp"))).toBe(false);
  });

  it("downloads assets with fetch(sourceHref) only when sourceToken is absent", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-pull-apply-href-asset-"));
    const configPath = await writeConfig(workspaceRoot);
    const proposalPath = await writeProposal(
      workspaceRoot,
      proposal({
        files: [],
        assets: [plannedAsset({ sourceToken: undefined, sourceHref: "https://stream/image-only" })]
      })
    );
    const run = vi.fn<ApplyRun>(async () => result());
    const bytes = Buffer.from("fetched bytes");
    const fetch = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    })) as unknown as typeof globalThis.fetch;
    globalThis.fetch = fetch;
    let saved: GitYourLarkRootState | undefined;

    const applied = await applyPullProposal({
      proposalPath,
      configPath,
      run,
      loadRootState: async () => rootState(),
      saveRootState: async (_path, state) => {
        saved = state;
      }
    });

    expect(applied).toMatchObject({
      ok: true,
      status: "applied",
      writtenAssets: ["参考资料/assets/故事块理论文献/image.webp"]
    });
    expect(run).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith("https://stream/image-only");
    await expect(readFile(join(workspaceRoot, "参考资料", "assets", "故事块理论文献", "image.webp"))).resolves.toEqual(bytes);
    expect(saved?.pull.assets["参考资料/assets/故事块理论文献/image.webp"]).toEqual({
      sourceUrl: "https://stream/image-only",
      localPath: "参考资料/assets/故事块理论文献/image.webp",
      ownerDocToken: "doc_theory",
      hash: sha256Buffer(bytes)
    });
  });

  it("rolls back an existing pull-owned Markdown file when saving state fails after final replacement", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-pull-apply-save-rollback-"));
    const configPath = await writeConfig(workspaceRoot);
    const originalMarkdown = "original imported markdown\n";
    const originalHash = sha256Text(originalMarkdown);
    const markdownPath = join(workspaceRoot, "参考资料", "故事块理论文献.md");
    await mkdir(join(workspaceRoot, "参考资料"), { recursive: true });
    await writeFile(markdownPath, originalMarkdown, "utf8");
    const proposalPath = await writeProposal(
      workspaceRoot,
      proposal({
        files: [plannedDocument({ expectedLocalHash: originalHash })]
      })
    );
    const run = vi.fn<ApplyRun>(async (_command, args) => fetchResult(args, { revisionId: "rev_1" }));

    const applied = await applyPullProposal({
      proposalPath,
      configPath,
      run,
      loadRootState: async () =>
        rootState({
          documents: {
            "参考资料/故事块理论文献.md": pullDocumentState({
              localHash: originalHash
            })
          }
        }),
      saveRootState: async () => {
        throw new Error("state disk full");
      },
      now: () => new Date("2026-06-23T00:00:00.000Z")
    });

    expect(applied).toMatchObject({
      ok: false,
      status: "failed",
      problems: ["state disk full"]
    });
    await expect(readFile(markdownPath, "utf8")).resolves.toBe(originalMarkdown);
  });

  it("restores existing state content when saving state corrupts the file and then fails", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-pull-apply-state-restore-"));
    const configPath = await writeConfig(workspaceRoot);
    const originalMarkdown = "original imported markdown\n";
    const originalHash = sha256Text(originalMarkdown);
    const markdownPath = join(workspaceRoot, "参考资料", "故事块理论文献.md");
    const statePath = join(workspaceRoot, ".git-your-lark", "state.json");
    const originalStateText = `${JSON.stringify(rootState({
      documents: {
        "参考资料/故事块理论文献.md": pullDocumentState({
          localHash: originalHash
        })
      }
    }), null, 2)}\n`;
    await mkdir(join(workspaceRoot, "参考资料"), { recursive: true });
    await mkdir(join(workspaceRoot, ".git-your-lark"), { recursive: true });
    await writeFile(markdownPath, originalMarkdown, "utf8");
    await writeFile(statePath, originalStateText, "utf8");
    const proposalPath = await writeProposal(
      workspaceRoot,
      proposal({
        files: [plannedDocument({ expectedLocalHash: originalHash })]
      })
    );
    const run = vi.fn<ApplyRun>(async (_command, args) => fetchResult(args, { revisionId: "rev_1" }));

    const applied = await applyPullProposal({
      proposalPath,
      configPath,
      run,
      loadRootState: async () =>
        rootState({
          documents: {
            "参考资料/故事块理论文献.md": pullDocumentState({
              localHash: originalHash
            })
          }
        }),
      saveRootState: async (path) => {
        await writeFile(path, "{corrupt", "utf8");
        throw new Error("state writer failed after partial write");
      },
      now: () => new Date("2026-06-23T00:00:00.000Z")
    });

    expect(applied).toMatchObject({
      ok: false,
      status: "failed",
      problems: ["state writer failed after partial write"]
    });
    await expect(readFile(markdownPath, "utf8")).resolves.toBe(originalMarkdown);
    await expect(readFile(statePath, "utf8")).resolves.toBe(originalStateText);
  });
});

async function writeConfig(workspaceRoot: string): Promise<string> {
  const configPath = join(workspaceRoot, "git-your-lark.yml");
  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(
    configPath,
    [
      'workspaceRoot: "."',
      "statePath: .git-your-lark/state.json",
      "pull:",
      "  source:",
      "    type: wiki_node",
      "    tokenOrUrl: wiki_parent",
      "  outputDir: .",
      ""
    ].join("\n"),
    "utf8"
  );
  return configPath;
}

async function writeProposal(workspaceRoot: string, value: PullProposal): Promise<string> {
  const proposalPath = join(workspaceRoot, ".git-your-lark", "proposals", `${value.id}.json`);
  await mkdir(join(workspaceRoot, ".git-your-lark", "proposals"), { recursive: true });
  await writeFile(proposalPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return proposalPath;
}

function proposal(input: Partial<PullProposal> = {}): PullProposal {
  return {
    id: "pull-proposal-test",
    createdAt: "2026-06-22T00:00:00.000Z",
    source: { type: "wiki_node", tokenOrUrl: "wiki_parent", title: "参考资料" },
    files: [],
    assets: [],
    blockers: [],
    warnings: [],
    ...input
  };
}

function plannedDocument(input: Partial<PullProposal["files"][number]> = {}): PullProposal["files"][number] {
  return {
    kind: "document",
    title: "故事块理论文献",
    docToken: "doc_theory",
    wikiNodeToken: "wiki_theory",
    sourceUrl: "https://example.feishu.cn/wiki/wiki_theory",
    remotePath: "参考资料/故事块理论文献",
    localPath: "参考资料/故事块理论文献.md",
    expectedRevisionId: "rev_1",
    ...input
  };
}

function plannedIndex(input: Partial<PullProposal["files"][number]> = {}): PullProposal["files"][number] {
  return {
    kind: "index",
    title: "参考资料",
    docToken: "doc_parent",
    wikiNodeToken: "wiki_parent",
    sourceUrl: "https://example.feishu.cn/wiki/wiki_parent",
    remotePath: "参考资料",
    localPath: "参考资料/参考资料.md",
    ...input
  };
}

function plannedAsset(input: Partial<PullProposal["assets"][number]> = {}): PullProposal["assets"][number] {
  return {
    ownerDocToken: "doc_theory",
    kind: "image",
    name: "image.webp",
    sourceToken: "img_token",
    sourceHref: "https://stream/image",
    localPath: "参考资料/assets/故事块理论文献/image.webp",
    ...input
  };
}

function fetchResult(args: string[], input: { revisionId: string }): CommandResult {
  if (args.includes("markdown")) {
    return result({
      stdout: JSON.stringify({
        data: {
          document: {
            content: "# 故事块理论文献\n\n![A](https://internal-api-drive-stream.feishu.cn/space/api/box/stream/img_token)\n",
            revision_id: input.revisionId
          }
        }
      })
    });
  }
  return result({
    stdout: JSON.stringify({
      data: {
        document: {
          content: [
            "<document>",
            "<title>故事块理论文献</title>",
            '<img name="image.webp" alt="A" href="https://stream/image" token="img_token"/>',
            "</document>"
          ].join(""),
          revision_id: input.revisionId
        }
      }
    })
  });
}

function rootState(input: { documents?: Record<string, PullDocumentState>; assets?: Record<string, PullAssetState> } = {}): GitYourLarkRootState {
  return {
    version: 2,
    publish: {
      version: 1,
      remoteFolderToken: "fld_publish",
      documents: {},
      attachments: {}
    },
    pull: {
      sources: {
        wiki_parent: {
          type: "wiki_node",
          tokenOrUrl: "wiki_parent",
          remoteTitle: "参考资料"
        }
      },
      documents: input.documents ?? {},
      assets: input.assets ?? {}
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
    remoteRevision: "rev_0",
    localHash: "old-hash",
    assetPaths: [],
    ...input
  };
}

function pullAssetState(input: Partial<PullAssetState> = {}): PullAssetState {
  return {
    sourceToken: "img_token",
    sourceUrl: "https://stream/image",
    localPath: "参考资料/assets/故事块理论文献/image.webp",
    ownerDocToken: "doc_theory",
    hash: "old-asset-hash",
    ...input
  };
}

function result(input: Partial<CommandResult> = {}): CommandResult {
  return {
    code: 0,
    stdout: "",
    stderr: "",
    ...input
  };
}
