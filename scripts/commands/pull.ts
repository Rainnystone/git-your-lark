import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, join, posix, resolve, sep } from "node:path";
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
  const existingLocalFiles = await collectExistingLocalFileHashes(workspaceRoot, pullConfig.outputDir, config.exclude);
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
  workspaceRoot: string,
  outputDir: string,
  exclude: string[]
): Promise<Map<string, string>> {
  const normalizedOutputDir = normalizeWorkspaceRelativePath(outputDir);
  const scanRoot = resolve(workspaceRoot, normalizedOutputDir);
  const realWorkspaceRoot = await realpath(workspaceRoot);

  if (!isInsideWorkspace(scanRoot, workspaceRoot)) {
    throw new Error(`Path escapes the workspace root: ${outputDir}`);
  }

  try {
    const rootStat = await stat(scanRoot);
    if (!rootStat.isDirectory()) {
      return new Map();
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return new Map();
    }
    throw error;
  }

  const realScanRoot = await realpath(scanRoot);
  if (!isInsideWorkspace(realScanRoot, realWorkspaceRoot)) {
    throw new Error(`Path escapes the workspace root: ${outputDir}`);
  }

  const ignore = [...new Set([...exclude, "node_modules/**", ".git/**", ".git-your-lark/**"])];
  const paths = await fg("**/*", {
    cwd: scanRoot,
    ignore,
    onlyFiles: true,
    dot: true,
    followSymbolicLinks: false
  });
  paths.sort();

  const existingLocalFiles = new Map<string, string>();
  for (const path of paths) {
    const absolutePath = resolve(scanRoot, path);
    const realFilePath = await realpath(absolutePath);
    if (!isInsideWorkspace(realFilePath, realWorkspaceRoot)) {
      throw new Error(`Path escapes the workspace root: ${joinRelative(normalizedOutputDir, path)}`);
    }
    const localPath = joinRelative(normalizedOutputDir, path);
    existingLocalFiles.set(localPath, sha256Buffer(await readFile(absolutePath)));
  }
  return existingLocalFiles;
}

function joinRelative(...parts: string[]): string {
  return normalizeWorkspaceRelativePath(posix.join(...parts.filter((part) => part !== "")));
}

function normalizeWorkspaceRelativePath(path: string): string {
  const posixPath = path.replace(/\\/g, "/").trim();
  if (!posixPath || posixPath === ".") {
    return "";
  }
  if (posix.isAbsolute(posixPath) || /^[A-Za-z]:/.test(posixPath)) {
    throw new Error(`Path must be relative to the workspace root: ${path}`);
  }
  const normalized = posix.normalize(posixPath).replace(/^\.\//, "");
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`Path escapes the workspace root: ${path}`);
  }
  return normalized;
}

function isInsideWorkspace(path: string, workspaceRoot: string): boolean {
  const resolvedPath = resolve(path);
  const resolvedRoot = resolve(workspaceRoot);
  return resolvedPath === resolvedRoot || resolvedPath.startsWith(`${resolvedRoot}${sep}`);
}
