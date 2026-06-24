import { readFile, stat } from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";
import fg from "fast-glob";
import { parseConfig, requirePullConfig } from "../lib/config.js";
import { readUtf8, writeJson, writeUtf8 } from "../lib/fs-utils.js";
import { sha256Buffer } from "../lib/hash.js";
import { applyPullProposal as defaultApplyPullProposal, type ApplyPullOptions } from "../lib/pull-apply.js";
import { fetchPullDocument as defaultFetchPullDocument, type PullFetchedDocument } from "../lib/pull-fetch.js";
import {
  buildPullProposal as defaultBuildPullProposal,
  renderPullProposalMarkdown as defaultRenderPullProposalMarkdown,
  type BuildPullProposalInput,
  type PullProposal
} from "../lib/pull-proposal.js";
import { scanPullSource as defaultScanPullSource } from "../lib/pull-source.js";
import type { PullScanResult } from "../lib/pull-types.js";
import { verifyPullWorkspace as defaultVerifyPullWorkspace } from "../lib/pull-verify.js";
import { loadRootState as defaultLoadRootState, type GitYourLarkRootState } from "../lib/state.js";
import { WorkspacePaths } from "../lib/workspace-paths.js";

export interface PullPreviewDependencies {
  scanPullSource?: (source: PullScanResult["source"]) => Promise<PullScanResult>;
  fetchPullDocument?: (docToken: string) => Promise<PullFetchedDocument>;
  loadRootState?: (path: string, remoteFolderToken?: string) => Promise<GitYourLarkRootState>;
  buildPullProposal?: (input: BuildPullProposalInput) => PullProposal;
  renderPullProposalMarkdown?: (proposal: PullProposal) => string;
  now?: () => Date;
}

export interface PullApplyDependencies {
  applyPullProposal?: (options: ApplyPullOptions) => Promise<Awaited<ReturnType<typeof defaultApplyPullProposal>>>;
}

export interface PullVerifyDependencies {
  loadRootState?: (path: string, remoteFolderToken?: string) => Promise<GitYourLarkRootState>;
  verifyPullWorkspace?: typeof defaultVerifyPullWorkspace;
}

export async function pullPreviewCommand(configPath: string, dependencies: PullPreviewDependencies = {}): Promise<number> {
  const scanPullSource = dependencies.scanPullSource ?? defaultScanPullSource;
  const fetchPullDocument = dependencies.fetchPullDocument ?? defaultFetchPullDocument;
  const loadRootState = dependencies.loadRootState ?? defaultLoadRootState;
  const buildPullProposal = dependencies.buildPullProposal ?? defaultBuildPullProposal;
  const renderPullProposalMarkdown = dependencies.renderPullProposalMarkdown ?? defaultRenderPullProposalMarkdown;
  const now = dependencies.now ?? (() => new Date());
  const resolvedConfigPath = resolve(configPath);
  const configDir = dirname(resolvedConfigPath);
  const config = parseConfig(await readUtf8(resolvedConfigPath));
  const pullConfig = requirePullConfig(config);
  const workspaceRoot = resolve(configDir, config.workspaceRoot);

  const scan = await scanPullSource(pullConfig.source);
  const fetchedDocuments = new Map<string, PullFetchedDocument>();
  for (const document of scan.documents) {
    fetchedDocuments.set(document.docToken, await fetchPullDocument(document.docToken));
  }

  const state = await loadRootState(resolve(workspaceRoot, config.statePath), config.remoteFolderToken);
  const paths = await WorkspacePaths.create(workspaceRoot);
  const existingLocalFiles = await collectExistingLocalFileHashes(paths, workspaceRoot, pullConfig.outputDir, config.exclude);
  const proposal = buildPullProposal({
    scan,
    fetchedDocuments,
    state,
    pull: pullConfig,
    existingLocalFiles,
    now: now()
  });
  const proposalDir = resolve(workspaceRoot, config.proposalDir);
  const jsonPath = join(proposalDir, `${proposal.id}.json`);
  const markdownPath = join(proposalDir, `${proposal.id}.md`);

  await writeJson(jsonPath, proposal);
  await writeUtf8(markdownPath, renderPullProposalMarkdown(proposal));

  console.log(`Wrote pull proposal JSON: ${jsonPath}`);
  console.log(`Wrote pull proposal Markdown: ${markdownPath}`);
  return proposal.blockers.length === 0 ? 0 : 2;
}

export async function pullApplyCommand(
  proposalPath: string,
  configPath: string,
  dependencies: PullApplyDependencies = {}
): Promise<number> {
  const applyPullProposal = dependencies.applyPullProposal ?? defaultApplyPullProposal;
  const result = await applyPullProposal({ proposalPath, configPath });

  console.log(JSON.stringify(result, null, 2));
  if (result.status === "applied") {
    return 0;
  }
  return result.status === "failed" ? 1 : 2;
}

export async function pullVerifyCommand(configPath: string, dependencies: PullVerifyDependencies = {}): Promise<number> {
  const loadRootState = dependencies.loadRootState ?? defaultLoadRootState;
  const verifyPullWorkspace = dependencies.verifyPullWorkspace ?? defaultVerifyPullWorkspace;
  const resolvedConfigPath = resolve(configPath);
  const configDir = dirname(resolvedConfigPath);
  const config = parseConfig(await readUtf8(resolvedConfigPath));
  requirePullConfig(config);
  const workspaceRoot = resolve(configDir, config.workspaceRoot);
  const state = await loadRootState(resolve(workspaceRoot, config.statePath), config.remoteFolderToken);
  const result = await verifyPullWorkspace({ workspaceRoot, state });

  console.log(JSON.stringify(result, null, 2));
  return result.ok ? 0 : 2;
}

async function collectExistingLocalFileHashes(
  paths: WorkspacePaths,
  workspaceRoot: string,
  outputDir: string,
  exclude: string[]
): Promise<Map<string, string>> {
  const posixOutputDir = outputDir.replace(/\\/g, "/").trim();
  const isRootItself = !posixOutputDir || posixOutputDir === ".";

  let scanRootAbsolute: string;
  let normalizedOutputDir: string;
  if (isRootItself) {
    scanRootAbsolute = workspaceRoot;
    normalizedOutputDir = "";
  } else {
    const safeOutputDir = await paths.safeWorkspacePath(posixOutputDir);
    scanRootAbsolute = safeOutputDir.absolutePath;
    normalizedOutputDir = safeOutputDir.relativePath;
  }

  try {
    const rootStat = await stat(scanRootAbsolute);
    if (!rootStat.isDirectory()) {
      return new Map();
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return new Map();
    }
    throw error;
  }

  const ignore = [...new Set([...exclude, "node_modules/**", ".git/**", ".git-your-lark/**"])];
  const discoveredPaths = await fg("**/*", {
    cwd: scanRootAbsolute,
    ignore,
    onlyFiles: true,
    dot: true,
    followSymbolicLinks: false
  });
  discoveredPaths.sort();

  const existingLocalFiles = new Map<string, string>();
  for (const discoveredPath of discoveredPaths) {
    const localPath = normalizedOutputDir ? posix.join(normalizedOutputDir, discoveredPath) : discoveredPath;
    const safeFilePath = await paths.safeWorkspacePath(localPath);
    existingLocalFiles.set(safeFilePath.relativePath, sha256Buffer(await readFile(safeFilePath.absolutePath)));
  }
  return existingLocalFiles;
}
