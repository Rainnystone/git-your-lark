import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  pullApplyCommand,
  pullPreviewCommand,
  pullVerifyCommand
} from "../../scripts/commands/pull.js";
import { applyPullProposal } from "../../scripts/lib/pull-apply.js";
import { scanPullSource } from "../../scripts/lib/pull-source.js";
import { fetchPullDocument } from "../../scripts/lib/pull-fetch.js";
import type { CommandResult } from "../../scripts/lib/lark-cli.js";
import type { PullProposal } from "../../scripts/lib/pull-proposal.js";
import type { GitYourLarkRootState } from "../../scripts/lib/state.js";

type Run = (command: string, args: string[], cwd?: string) => Promise<CommandResult>;

describe("pull workflow e2e", () => {
  it("previews, applies, and verifies a wiki_node pull with assets and local links", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-pull-e2e-"));
    const configPath = await writePullConfig(workspaceRoot);
    const run = vi.fn<Run>(async (command, args, cwd) => mockedLarkCli(command, args, cwd));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const previewExit = await pullPreviewCommand(configPath, {
        scanPullSource: (source) => scanPullSource(source, run),
        fetchPullDocument: (docToken) => fetchPullDocument(docToken, run),
        now: () => new Date("2026-06-23T00:00:00.000Z")
      });

      const proposalPath = join(workspaceRoot, ".git-your-lark", "proposals", "pull-proposal-2026-06-23T00-00-00-000Z.json");
      const proposal = JSON.parse(await readUtf8(proposalPath)) as PullProposal;

      expect(previewExit).toBe(0);
      expect(proposal.blockers).toEqual([]);
      expect(proposal.files.map((file) => [file.kind, file.localPath])).toEqual([
        ["index", "参考资料/参考资料.md"],
        ["document", "参考资料/故事块理论文献.md"]
      ]);
      expect(proposal.assets.map((asset) => [asset.sourceToken, asset.localPath])).toEqual([
        ["img_story_blocks", "参考资料/assets/故事块理论文献/story-blocks.png"]
      ]);

      const applyExit = await pullApplyCommand(proposalPath, configPath, {
        applyPullProposal: (options) =>
          applyPullProposal({
            ...options,
            run,
            now: () => new Date("2026-06-23T00:01:00.000Z")
          })
      });
      const verifyExit = await pullVerifyCommand(configPath);

      expect(applyExit).toBe(0);
      expect(verifyExit).toBe(0);
      expect(await readUtf8(join(workspaceRoot, "参考资料", "参考资料.md"))).toContain("[[故事块理论文献]]");

      const pulledDocument = await readUtf8(join(workspaceRoot, "参考资料", "故事块理论文献.md"));
      expect(pulledDocument).toContain("gyl:");
      expect(pulledDocument).toContain('token: "doc_theory"');
      expect(pulledDocument).toContain('wiki_node_token: "wiki_theory"');
      expect(pulledDocument).toContain("![Story blocks](assets/故事块理论文献/story-blocks.png)");
      expect(pulledDocument).toContain("[[参考资料]]");
      expect(pulledDocument).not.toContain("internal-api-drive-stream.feishu.cn");

      expect(await readFile(join(workspaceRoot, "参考资料", "assets", "故事块理论文献", "story-blocks.png"))).toEqual(
        Buffer.from("mock image bytes")
      );

      const state = JSON.parse(await readUtf8(join(workspaceRoot, ".git-your-lark", "state.json"))) as GitYourLarkRootState;
      expect(state.pull.documents["参考资料/参考资料.md"]).toMatchObject({
        docToken: "doc_reference",
        wikiNodeToken: "wiki_reference",
        remoteTitle: "参考资料",
        remotePath: "参考资料",
        localPath: "参考资料/参考资料.md",
        assetPaths: []
      });
      expect(state.pull.documents["参考资料/故事块理论文献.md"]).toMatchObject({
        docToken: "doc_theory",
        wikiNodeToken: "wiki_theory",
        remoteTitle: "故事块理论文献",
        remotePath: "参考资料/故事块理论文献",
        localPath: "参考资料/故事块理论文献.md",
        remoteRevision: "rev_theory",
        assetPaths: ["参考资料/assets/故事块理论文献/story-blocks.png"]
      });
      expect(state.pull.assets["参考资料/assets/故事块理论文献/story-blocks.png"]).toMatchObject({
        sourceToken: "img_story_blocks",
        ownerDocToken: "doc_theory",
        localPath: "参考资料/assets/故事块理论文献/story-blocks.png"
      });
      expect(state.pull.sources["wiki_node:wiki_reference"]).toEqual({
        type: "wiki_node",
        tokenOrUrl: "wiki_reference",
        remoteTitle: "参考资料",
        lastPulledAt: "2026-06-23T00:01:00.000Z"
      });

      log.mockClear();
      await writeFile(
        join(workspaceRoot, "参考资料", "故事块理论文献.md"),
        `${pulledDocument}\n[[未知文档]]\n`,
        "utf8"
      );
      const brokenVerifyExit = await pullVerifyCommand(configPath);

      expect(brokenVerifyExit).toBe(2);
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining(
          "Wiki link in pulled collection points outside known pulled documents: 参考资料/故事块理论文献.md -> 未知文档"
        )
      );
      expect(run.mock.calls.map(([, args]) => `${args[0]} ${args[1]}`)).toEqual(
        expect.arrayContaining(["wiki +node-get", "wiki +node-list", "docs +fetch", "docs +media-download"])
      );
    } finally {
      log.mockRestore();
    }
  });
});

async function writePullConfig(workspaceRoot: string): Promise<string> {
  await mkdir(workspaceRoot, { recursive: true });
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
      "    tokenOrUrl: wiki_reference",
      '  outputDir: "."',
      ""
    ].join("\n"),
    "utf8"
  );
  return configPath;
}

async function mockedLarkCli(command: string, args: string[], cwd?: string): Promise<CommandResult> {
  expect(command).toBe("lark-cli");
  if (args[0] === "wiki" && args[1] === "+node-get") {
    return jsonResult({
      data: {
        node: {
          title: "参考资料",
          node_token: "wiki_reference",
          obj_token: "doc_reference",
          obj_type: "docx",
          has_child: true,
          space_id: "space_story"
        }
      }
    });
  }

  if (args[0] === "wiki" && args[1] === "+node-list") {
    return jsonResult({
      data: {
        items: [
          {
            title: "故事块理论文献",
            node_token: "wiki_theory",
            obj_token: "doc_theory",
            obj_type: "docx",
            has_child: false
          }
        ]
      }
    });
  }

  if (args[0] === "docs" && args[1] === "+fetch") {
    const docToken = requiredArg(args, "--doc");
    const docFormat = requiredArg(args, "--doc-format");
    return jsonResult({
      data: {
        document: {
          content: docFormat === "markdown" ? markdownFixture(docToken) : xmlFixture(docToken),
          revision_id: revisionFixture(docToken)
        }
      }
    });
  }

  if (args[0] === "docs" && args[1] === "+media-download") {
    const token = requiredArg(args, "--token");
    const output = requiredArg(args, "--output");
    if (token !== "img_story_blocks") {
      return { code: 1, stdout: "", stderr: `unexpected media token ${token}` };
    }
    if (!cwd) {
      return { code: 1, stdout: "", stderr: "missing media download cwd" };
    }
    await writeFile(join(cwd, output), Buffer.from("mock image bytes"));
    return jsonResult({ data: { path: output } });
  }

  return { code: 1, stdout: "", stderr: `unexpected lark-cli args: ${args.join(" ")}` };
}

function markdownFixture(docToken: string): string {
  if (docToken === "doc_reference") {
    return "# 参考资料\n\n合集入口。\n";
  }
  if (docToken === "doc_theory") {
    return [
      "# 故事块理论文献",
      "",
      "参考根节点：https://example.feishu.cn/wiki/wiki_reference",
      "",
      "![Story blocks](https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/all/img_story_blocks/)",
      ""
    ].join("\n");
  }
  throw new Error(`Unexpected doc token: ${docToken}`);
}

function xmlFixture(docToken: string): string {
  if (docToken === "doc_reference") {
    return "<document><title>参考资料</title></document>";
  }
  if (docToken === "doc_theory") {
    return [
      "<document>",
      "<title>故事块理论文献</title>",
      '<img token="img_story_blocks" url="https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/all/img_story_blocks/" name="story-blocks.png" alt="Story blocks"/>',
      "</document>"
    ].join("");
  }
  throw new Error(`Unexpected doc token: ${docToken}`);
}

function revisionFixture(docToken: string): string {
  if (docToken === "doc_reference") {
    return "rev_reference";
  }
  if (docToken === "doc_theory") {
    return "rev_theory";
  }
  throw new Error(`Unexpected doc token: ${docToken}`);
}

function jsonResult(value: unknown): CommandResult {
  return {
    code: 0,
    stdout: JSON.stringify(value),
    stderr: ""
  };
}

function requiredArg(args: string[], name: string): string {
  const index = args.indexOf(name);
  if (index === -1 || index === args.length - 1) {
    throw new Error(`Missing ${name} in ${args.join(" ")}`);
  }
  return args[index + 1];
}

async function readUtf8(path: string): Promise<string> {
  return readFile(path, "utf8");
}
