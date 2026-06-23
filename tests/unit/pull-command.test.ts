import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  pullApplyCommand,
  pullPreviewCommand,
  pullVerifyCommand
} from "../../scripts/commands/pull.js";
import type { PullFetchedDocument } from "../../scripts/lib/pull-fetch.js";
import type { PullProposal } from "../../scripts/lib/pull-proposal.js";
import type { PullScanResult } from "../../scripts/lib/pull-types.js";
import type { GitYourLarkRootState } from "../../scripts/lib/state.js";

describe("pullPreviewCommand", () => {
  it("writes JSON and Markdown previews under the configured proposal directory", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-pull-command-preview-"));
    const configPath = await writePullConfig(workspaceRoot);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const exitCode = await pullPreviewCommand(configPath, {
        scanPullSource: async () => scanResult(),
        fetchPullDocument: async () => fetchedDocument(),
        loadRootState: async () => rootState(),
        now: () => new Date("2026-06-23T00:00:00.000Z")
      });

      const jsonPath = join(workspaceRoot, ".git-your-lark", "proposals", "pull-proposal-2026-06-23T00-00-00-000Z.json");
      const markdownPath = join(workspaceRoot, ".git-your-lark", "proposals", "pull-proposal-2026-06-23T00-00-00-000Z.md");
      await expect(readFile(jsonPath, "utf8")).resolves.toContain('"id": "pull-proposal-2026-06-23T00-00-00-000Z"');
      await expect(readFile(markdownPath, "utf8")).resolves.toContain("# Pull Proposal pull-proposal-2026-06-23T00-00-00-000Z");
      expect(log).toHaveBeenCalledWith(`Wrote pull proposal JSON: ${jsonPath}`);
      expect(log).toHaveBeenCalledWith(`Wrote pull proposal Markdown: ${markdownPath}`);
      expect(exitCode).toBe(0);
    } finally {
      log.mockRestore();
    }
  });

  it("returns 2 when the preview has blockers", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-pull-command-blockers-"));
    const configPath = await writePullConfig(workspaceRoot);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const exitCode = await pullPreviewCommand(configPath, {
        scanPullSource: async () => scanResult(),
        fetchPullDocument: async () => fetchedDocument(),
        loadRootState: async () => rootState(),
        buildPullProposal: () =>
          proposal({
            blockers: ["Existing local file is not owned by pull state: 参考资料/故事块理论文献.md"]
          })
      });

      expect(exitCode).toBe(2);
    } finally {
      log.mockRestore();
    }
  });

  it("blocks a planned document path that already exists outside pull state", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-pull-command-existing-local-"));
    const configPath = await writePullConfig(workspaceRoot);
    const existingPath = join(workspaceRoot, "参考资料", "故事块理论文献.md");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await mkdir(join(workspaceRoot, "参考资料"), { recursive: true });
    await writeFile(existingPath, "# 本地已有文档\n", "utf8");

    try {
      const exitCode = await pullPreviewCommand(configPath, {
        scanPullSource: async () => scanResult(),
        fetchPullDocument: async () => fetchedDocument(),
        loadRootState: async () => rootState(),
        now: () => new Date("2026-06-23T00:00:00.000Z")
      });

      const jsonPath = join(workspaceRoot, ".git-your-lark", "proposals", "pull-proposal-2026-06-23T00-00-00-000Z.json");
      const proposalJson = JSON.parse(await readFile(jsonPath, "utf8")) as PullProposal;

      expect(exitCode).toBe(2);
      expect(proposalJson.blockers).toContain(
        "Existing local file is not owned by pull state: 参考资料/故事块理论文献.md"
      );
    } finally {
      log.mockRestore();
    }
  });

  it("rejects a pull outputDir symlink that resolves outside the workspace before scanning local files", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-pull-command-symlink-output-"));
    const externalRoot = await mkdtemp(join(tmpdir(), "gyl-pull-command-external-output-"));
    const linkedOutputDir = join(workspaceRoot, "linked-output");
    await symlink(externalRoot, linkedOutputDir, "dir");
    await writeFile(join(externalRoot, "outside.md"), "# outside workspace\n", "utf8");
    const configPath = await writePullConfig(workspaceRoot, "linked-output");
    const buildPullProposal = vi.fn(() => proposal());

    await expect(
      pullPreviewCommand(configPath, {
        scanPullSource: async () => scanResult(),
        fetchPullDocument: async () => fetchedDocument(),
        loadRootState: async () => rootState(),
        buildPullProposal
      })
    ).rejects.toThrow(/escapes the workspace root/);
    expect(buildPullProposal).not.toHaveBeenCalled();
  });
});

describe("pullApplyCommand", () => {
  it.each([
    ["applied", 0],
    ["failed", 1],
    ["blocked", 2],
    ["conflict", 2]
  ] as const)("prints apply results and maps %s to exit code %d", async (status, expectedExitCode) => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const exitCode = await pullApplyCommand("proposal.json", "git-your-lark.yml", {
        applyPullProposal: async () => ({
          ok: status === "applied",
          status,
          problems: status === "applied" ? [] : [`${status} problem`],
          writtenFiles: status === "applied" ? ["参考资料/故事块理论文献.md"] : [],
          writtenAssets: []
        })
      });

      expect(log).toHaveBeenCalledWith(expect.stringContaining(`"status": "${status}"`));
      expect(exitCode).toBe(expectedExitCode);
    } finally {
      log.mockRestore();
    }
  });
});

describe("pullVerifyCommand", () => {
  it.each([
    [true, 0],
    [false, 2]
  ] as const)("prints verify results and maps ok=%s to exit code %d", async (ok, expectedExitCode) => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-pull-command-verify-"));
    const configPath = await writePullConfig(workspaceRoot);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const exitCode = await pullVerifyCommand(configPath, {
        loadRootState: async () => rootState(),
        verifyPullWorkspace: async () => ({
          ok,
          problems: ok ? [] : ["Missing pulled Markdown file: 参考资料/故事块理论文献.md"],
          checkedFiles: ["参考资料/故事块理论文献.md"],
          checkedAssets: []
        })
      });

      expect(log).toHaveBeenCalledWith(expect.stringContaining(`"ok": ${ok}`));
      expect(exitCode).toBe(expectedExitCode);
    } finally {
      log.mockRestore();
    }
  });
});

async function writePullConfig(workspaceRoot: string, outputDir = "."): Promise<string> {
  const configPath = join(workspaceRoot, "git-your-lark.yml");
  await writeFile(
    configPath,
    [
      'workspaceRoot: "."',
      "statePath: .git-your-lark/state.json",
      "proposalDir: .git-your-lark/proposals",
      "pull:",
      "  source:",
      "    type: wiki_node",
      "    tokenOrUrl: wiki_parent",
      `  outputDir: ${outputDir}`,
      ""
    ].join("\n"),
    "utf8"
  );
  return configPath;
}

function scanResult(): PullScanResult {
  return {
    source: { type: "wiki_node", tokenOrUrl: "wiki_parent", title: "参考资料" },
    indexes: [],
    documents: [
      {
        sourceKind: "wiki_node",
        title: "故事块理论文献",
        docToken: "doc_theory",
        wikiNodeToken: "wiki_theory",
        remotePath: "参考资料/故事块理论文献"
      }
    ],
    warnings: []
  };
}

function fetchedDocument(): PullFetchedDocument {
  return {
    docToken: "doc_theory",
    title: "故事块理论文献",
    markdown: "# 故事块理论文献\n\n正文",
    xml: "<document><title>故事块理论文献</title></document>",
    revisionId: "rev_1",
    media: []
  };
}

function proposal(input: Partial<PullProposal> = {}): PullProposal {
  return {
    id: "pull-proposal-test",
    createdAt: "2026-06-23T00:00:00.000Z",
    source: { type: "wiki_node", tokenOrUrl: "wiki_parent", title: "参考资料" },
    files: [],
    assets: [],
    blockers: [],
    warnings: [],
    ...input
  };
}

function rootState(): GitYourLarkRootState {
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
      assets: {}
    }
  };
}
