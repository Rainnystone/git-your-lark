import { copyFile, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { posix } from "node:path";
import { parseConfig, requirePullConfig } from "./config.js";
import { readJson, readUtf8, writeUtf8 } from "./fs-utils.js";
import { sha256Buffer, sha256Text } from "./hash.js";
import { runCommand, type CommandResult } from "./lark-cli.js";
import { fetchPullDocument, type PullFetchedDocument, type PullFetchedMedia } from "./pull-fetch.js";
import {
  buildPullLinkIndex,
  type PullPlannedAsset,
  type PullPlannedFile,
  type PullProposal
} from "./pull-proposal.js";
import { renderPullIndexMarkdown, renderPullMarkdown, type PullMediaPlan } from "./pull-render.js";
import type { PullRemoteDocument, PullRemoteIndex } from "./pull-types.js";
import {
  loadRootState as defaultLoadRootState,
  saveRootState as defaultSaveRootState,
  type GitYourLarkRootState,
  type PullAssetState,
  type PullDocumentState
} from "./state.js";

export type CommandRunner = (command: string, args: string[], cwd?: string) => Promise<CommandResult>;

export interface ApplyPullOptions {
  proposalPath: string;
  configPath: string;
  run?: CommandRunner;
  loadRootState?: typeof defaultLoadRootState;
  saveRootState?: typeof defaultSaveRootState;
  now?: () => Date;
}

export interface ApplyPullResult {
  ok: boolean;
  status: "applied" | "blocked" | "conflict" | "failed";
  problems: string[];
  writtenFiles: string[];
  writtenAssets: string[];
}

interface SafePath {
  relativePath: string;
  absolutePath: string;
}

interface PathSafetyContext {
  realWorkspaceRoot: string;
}

interface StateFileSnapshot {
  existed: boolean;
  contents?: Buffer;
}

interface RenderedFile {
  file: PullPlannedFile;
  remoteTitle: string;
  markdown: string;
  hash: string;
  revisionId?: string;
  assetPaths: string[];
}

interface FinalReplacement {
  kind: "file" | "asset";
  localPath: string;
  finalPath: SafePath;
  stagedPath: SafePath;
  backupPath: SafePath;
  existed: boolean;
}

export async function applyPullProposal(options: ApplyPullOptions): Promise<ApplyPullResult> {
  const run = options.run ?? runCommand;
  const loadRootState = options.loadRootState ?? defaultLoadRootState;
  const saveRootState = options.saveRootState ?? defaultSaveRootState;
  const now = options.now ?? (() => new Date());
  const writtenFiles: string[] = [];
  const writtenAssets: string[] = [];
  const cleanupTargets: string[] = [];

  try {
    const configPath = resolve(options.configPath);
    const proposalPath = resolve(options.proposalPath);
    const config = parseConfig(await readUtf8(configPath));
    const pullConfig = requirePullConfig(config);
    const proposal = await readJson<PullProposal>(proposalPath);
    const sourceProblem = validateProposalSource(proposal, pullConfig);
    if (sourceProblem) {
      return {
        ok: false,
        status: "blocked",
        problems: [sourceProblem],
        writtenFiles,
        writtenAssets
      };
    }

    if (proposal.blockers.length > 0) {
      return {
        ok: false,
        status: "blocked",
        problems: proposal.blockers,
        writtenFiles,
        writtenAssets
      };
    }

    const workspaceRoot = resolve(dirname(configPath), config.workspaceRoot);
    const pathSafety = await createPathSafetyContext(workspaceRoot);
    const statePath = resolve(workspaceRoot, config.statePath);
    const state = await loadRootState(statePath, config.remoteFolderToken);
    const safeFiles = new Map<PullPlannedFile, SafePath>();
    const safeAssets = new Map<PullPlannedAsset, SafePath>();
    const stagedFiles = new Map<PullPlannedFile, SafePath>();
    const stagedAssets = new Map<PullPlannedAsset, SafePath>();
    const localProblems: string[] = [];
    const applyStartedAt = now();
    const stagingRoot = safeWorkspacePath(
      workspaceRoot,
      posix.join(".git-your-lark", "apply-staging", `${sanitizePathSegment(proposal.id)}-${applyStartedAt.getTime()}`)
    );
    const backupRoot = safeWorkspacePath(
      workspaceRoot,
      posix.join(".git-your-lark", "apply-backups", `${sanitizePathSegment(proposal.id)}-${applyStartedAt.getTime()}`)
    );
    cleanupTargets.push(stagingRoot.absolutePath, backupRoot.absolutePath);
    await assertSafeTargetPath(pathSafety, stagingRoot);
    await assertSafeTargetPath(pathSafety, backupRoot);

    for (const file of proposal.files) {
      const safePath = safeWorkspacePath(workspaceRoot, file.localPath);
      await assertSafeTargetPath(pathSafety, safePath);
      safeFiles.set(file, safePath);
      const stagedPath = safeWorkspacePath(workspaceRoot, posix.join(stagingRoot.relativePath, safePath.relativePath));
      await assertSafeTargetPath(pathSafety, stagedPath);
      stagedFiles.set(file, stagedPath);
      const problem = await validateFileOverwrite(file, safePath, state);
      if (problem) {
        localProblems.push(problem);
      }
    }

    for (const asset of proposal.assets) {
      const safePath = safeWorkspacePath(workspaceRoot, asset.localPath);
      await assertSafeTargetPath(pathSafety, safePath);
      safeAssets.set(asset, safePath);
      const stagedPath = safeWorkspacePath(workspaceRoot, posix.join(stagingRoot.relativePath, safePath.relativePath));
      await assertSafeTargetPath(pathSafety, stagedPath);
      stagedAssets.set(asset, stagedPath);
      const problem = await validateAssetOverwrite(asset, safePath, state);
      if (problem) {
        localProblems.push(problem);
      }
    }

    if (localProblems.length > 0) {
      return {
        ok: false,
        status: "conflict",
        problems: localProblems,
        writtenFiles,
        writtenAssets
      };
    }

    const fetchedByToken = new Map<string, PullFetchedDocument>();
    const revisionProblems: string[] = [];
    for (const file of proposal.files) {
      const fetched = await fetchPullDocument(file.docToken, run);
      fetchedByToken.set(file.docToken, fetched);
      if (file.expectedRevisionId && fetched.revisionId !== file.expectedRevisionId) {
        revisionProblems.push(
          `Remote document changed since proposal for ${file.localPath}: expected revision ${file.expectedRevisionId}, found ${fetched.revisionId ?? "missing"}`
        );
      }
    }

    if (revisionProblems.length > 0) {
      return {
        ok: false,
        status: "conflict",
        problems: revisionProblems,
        writtenFiles,
        writtenAssets
      };
    }

    const pulledAt = applyStartedAt.toISOString();
    const renderedFiles = renderPlannedFiles(proposal, fetchedByToken, pulledAt);
    const assetHashes = new Map<string, string>();
    const fileHashes = new Map<string, string>();

    for (const asset of proposal.assets) {
      const stagedPath = requireSafePath(stagedAssets, asset);
      const hash = await downloadAsset(asset, stagedPath, workspaceRoot, pathSafety, run);
      assetHashes.set(asset.localPath, hash);
    }

    for (const rendered of renderedFiles) {
      const stagedPath = requireSafePath(stagedFiles, rendered.file);
      await writeUtf8(stagedPath.absolutePath, rendered.markdown);
      fileHashes.set(rendered.file.localPath, await currentTextHashOrThrow(stagedPath.absolutePath));
    }

    const finalProblems: string[] = [];
    for (const file of proposal.files) {
      const problem = await validateFileOverwrite(file, requireSafePath(safeFiles, file), state);
      if (problem) {
        finalProblems.push(problem);
      }
    }
    for (const asset of proposal.assets) {
      const problem = await validateAssetOverwrite(asset, requireSafePath(safeAssets, asset), state);
      if (problem) {
        finalProblems.push(problem);
      }
    }
    if (finalProblems.length > 0) {
      return {
        ok: false,
        status: "conflict",
        problems: finalProblems,
        writtenFiles,
        writtenAssets
      };
    }

    const nextState = nextPullState(state);
    for (const asset of proposal.assets) {
      nextState.pull.assets[asset.localPath] = {
        ...(asset.sourceToken ? { sourceToken: asset.sourceToken } : {}),
        ...(asset.sourceHref ? { sourceUrl: asset.sourceHref } : {}),
        localPath: asset.localPath,
        ownerDocToken: asset.ownerDocToken,
        hash: assetHashes.get(asset.localPath) ?? ""
      };
    }

    for (const rendered of renderedFiles) {
      nextState.pull.documents[rendered.file.localPath] = {
        docToken: rendered.file.docToken,
        ...(rendered.file.wikiNodeToken ? { wikiNodeToken: rendered.file.wikiNodeToken } : {}),
        ...(rendered.file.sourceUrl ? { sourceUrl: rendered.file.sourceUrl } : {}),
        remoteTitle: rendered.remoteTitle,
        remotePath: rendered.file.remotePath,
        localPath: rendered.file.localPath,
        ...(rendered.revisionId ? { remoteRevision: rendered.revisionId } : {}),
        localHash: fileHashes.get(rendered.file.localPath) ?? rendered.hash,
        assetPaths: rendered.assetPaths
      };
    }

    const replacements: FinalReplacement[] = [
      ...proposal.assets.map((asset): FinalReplacement => {
        const finalPath = requireSafePath(safeAssets, asset);
        return {
          kind: "asset",
          localPath: asset.localPath,
          finalPath,
          stagedPath: requireSafePath(stagedAssets, asset),
          backupPath: safeWorkspacePath(workspaceRoot, posix.join(backupRoot.relativePath, finalPath.relativePath)),
          existed: false
        };
      }),
      ...renderedFiles.map((rendered): FinalReplacement => {
        const finalPath = requireSafePath(safeFiles, rendered.file);
        return {
          kind: "file",
          localPath: rendered.file.localPath,
          finalPath,
          stagedPath: requireSafePath(stagedFiles, rendered.file),
          backupPath: safeWorkspacePath(workspaceRoot, posix.join(backupRoot.relativePath, finalPath.relativePath)),
          existed: false
        };
      })
    ];

    let stateSnapshot: StateFileSnapshot | undefined;
    let stateSaveStarted = false;
    try {
      stateSnapshot = await snapshotStateFile(statePath);
      await backupFinalPaths(replacements, pathSafety);
      for (const replacement of replacements) {
        await replaceFromStaging(replacement, pathSafety);
        if (replacement.kind === "asset") {
          writtenAssets.push(replacement.localPath);
        } else {
          writtenFiles.push(replacement.localPath);
        }
      }
      stateSaveStarted = true;
      await saveRootState(statePath, nextState);
    } catch (error) {
      const problems = [error instanceof Error ? error.message : String(error)];
      if (stateSaveStarted && stateSnapshot) {
        problems.push(...await restoreStateFile(statePath, stateSnapshot));
      }
      problems.push(...await rollbackFinalPaths(replacements, pathSafety));
      return {
        ok: false,
        status: "failed",
        problems,
        writtenFiles,
        writtenAssets
      };
    }

    return {
      ok: true,
      status: "applied",
      problems: [],
      writtenFiles,
      writtenAssets
    };
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      problems: [error instanceof Error ? error.message : String(error)],
      writtenFiles,
      writtenAssets
    };
  } finally {
    await cleanupBestEffort(cleanupTargets);
  }
}

function validateProposalSource(
  proposal: PullProposal,
  pullConfig: ReturnType<typeof requirePullConfig>
): string | undefined {
  const expectedType = pullConfig.source.type;
  const expectedTokenOrUrl = pullConfig.source.tokenOrUrl.trim();
  const foundType = proposal.source.type;
  const foundTokenOrUrl = proposal.source.tokenOrUrl.trim();
  if (expectedType === foundType && expectedTokenOrUrl === foundTokenOrUrl) {
    return undefined;
  }
  return `Pull proposal source does not match current config: expected ${expectedType} ${expectedTokenOrUrl}, found ${foundType} ${foundTokenOrUrl}`;
}

async function backupFinalPaths(replacements: FinalReplacement[], pathSafety: PathSafetyContext): Promise<void> {
  for (const replacement of replacements) {
    try {
      await assertSafeTargetPath(pathSafety, replacement.finalPath);
      await assertSafeTargetPath(pathSafety, replacement.backupPath);
      await mkdir(dirname(replacement.backupPath.absolutePath), { recursive: true });
      await copyFile(replacement.finalPath.absolutePath, replacement.backupPath.absolutePath);
      replacement.existed = true;
    } catch (error) {
      if (!isEnoent(error)) {
        throw error;
      }
      replacement.existed = false;
    }
  }
}

async function replaceFromStaging(replacement: FinalReplacement, pathSafety: PathSafetyContext): Promise<void> {
  await assertSafeTargetPath(pathSafety, replacement.stagedPath);
  await assertSafeTargetPath(pathSafety, replacement.finalPath);
  await mkdir(dirname(replacement.finalPath.absolutePath), { recursive: true });
  await copyFile(replacement.stagedPath.absolutePath, replacement.finalPath.absolutePath);
}

async function rollbackFinalPaths(replacements: FinalReplacement[], pathSafety: PathSafetyContext): Promise<string[]> {
  const problems: string[] = [];
  for (const replacement of [...replacements].reverse()) {
    try {
      await assertSafeTargetPath(pathSafety, replacement.finalPath);
      if (replacement.existed) {
        await assertSafeTargetPath(pathSafety, replacement.backupPath);
        await mkdir(dirname(replacement.finalPath.absolutePath), { recursive: true });
        await copyFile(replacement.backupPath.absolutePath, replacement.finalPath.absolutePath);
      } else {
        await rm(replacement.finalPath.absolutePath, { force: true });
      }
    } catch (error) {
      problems.push(
        `Failed to roll back ${replacement.localPath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return problems;
}

async function snapshotStateFile(path: string): Promise<StateFileSnapshot> {
  try {
    return { existed: true, contents: await readFile(path) };
  } catch (error) {
    if (isEnoent(error)) {
      return { existed: false };
    }
    throw error;
  }
}

async function restoreStateFile(path: string, snapshot: StateFileSnapshot): Promise<string[]> {
  try {
    if (snapshot.existed) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, snapshot.contents ?? Buffer.alloc(0));
    } else {
      await rm(path, { force: true });
    }
    return [];
  } catch (error) {
    return [`Failed to restore state file: ${error instanceof Error ? error.message : String(error)}`];
  }
}

async function cleanupBestEffort(paths: string[]): Promise<void> {
  for (const path of paths) {
    try {
      await rm(path, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup should not mask the apply result.
    }
  }
}

function renderPlannedFiles(
  proposal: PullProposal,
  fetchedByToken: Map<string, PullFetchedDocument>,
  pulledAt: string
): RenderedFile[] {
  const linkIndex = buildPullLinkIndex(proposal.files);
  const assetsByOwner = groupAssetsByOwner(proposal.assets);
  const rendered: RenderedFile[] = [];

  for (const file of proposal.files) {
    if (file.kind === "document") {
      const fetched = fetchedByToken.get(file.docToken);
      if (!fetched) {
        throw new Error(`Fetched document is missing for planned file: ${file.docToken}`);
      }
      const ownedAssets = assetsByOwner.get(file.docToken) ?? [];
      const remote = plannedDocumentToRemote(file, proposal, fetched);
      const mediaPlans = ownedAssets.map((asset): PullMediaPlan => ({
        kind: asset.kind,
        name: asset.name,
        alt: findFetchedMediaAlt(fetched.media, asset),
        ...(asset.sourceToken ? { sourceToken: asset.sourceToken } : {}),
        ...(asset.sourceHref ? { sourceHref: asset.sourceHref } : {}),
        localPath: relativePathFromDocument(file.localPath, asset.localPath)
      }));
      const markdown = renderPullMarkdown({
        markdown: fetched.markdown,
        remote,
        plannedPath: file.localPath,
        index: linkIndex,
        mediaPlans,
        pulledAt
      }).markdown;
      rendered.push({
        file,
        remoteTitle: remote.title,
        markdown,
        hash: sha256Text(markdown),
        ...(fetched.revisionId ? { revisionId: fetched.revisionId } : {}),
        assetPaths: ownedAssets.map((asset) => asset.localPath)
      });
      continue;
    }

    const fetched = fetchedByToken.get(file.docToken);
    const remote = plannedIndexToRemote(file, proposal, fetched);
    const markdown = renderPullIndexMarkdown({
      remote,
      plannedPath: file.localPath,
      index: linkIndex,
      pulledAt
    });
    rendered.push({
      file,
      remoteTitle: remote.title,
      markdown,
      hash: sha256Text(markdown),
      ...(fetched?.revisionId ? { revisionId: fetched.revisionId } : {}),
      assetPaths: []
    });
  }

  return rendered;
}

async function validateFileOverwrite(
  file: PullPlannedFile,
  safePath: SafePath,
  state: GitYourLarkRootState
): Promise<string | undefined> {
  const currentHash = await currentTextHash(safePath.absolutePath);
  if (!currentHash) {
    return undefined;
  }

  const owned = findPullDocumentState(state, file);
  if (!owned || !file.expectedLocalHash) {
    return `Existing local file is not owned by pull state: ${file.localPath}`;
  }
  if (currentHash !== file.expectedLocalHash) {
    return `Existing pull-owned file has local changes since proposal: ${file.localPath}`;
  }
  if (owned.localHash !== file.expectedLocalHash) {
    return `Existing pull-owned file state differs from proposal: ${file.localPath}`;
  }
  return undefined;
}

async function validateAssetOverwrite(
  asset: PullPlannedAsset,
  safePath: SafePath,
  state: GitYourLarkRootState
): Promise<string | undefined> {
  const currentHash = await currentBufferHash(safePath.absolutePath);
  if (!currentHash) {
    return undefined;
  }

  const owned = findPullAssetState(state, asset);
  if (!owned || !asset.expectedLocalHash) {
    return `Existing local asset is not owned by pull state: ${asset.localPath}`;
  }
  if (currentHash !== asset.expectedLocalHash) {
    return `Existing pull-owned asset has local changes since proposal: ${asset.localPath}`;
  }
  if (owned.hash !== asset.expectedLocalHash) {
    return `Existing pull-owned asset state differs from proposal: ${asset.localPath}`;
  }
  return undefined;
}

async function downloadAsset(
  asset: PullPlannedAsset,
  safePath: SafePath,
  workspaceRoot: string,
  pathSafety: PathSafetyContext,
  run: CommandRunner
): Promise<string> {
  await assertSafeTargetPath(pathSafety, safePath);
  await mkdir(dirname(safePath.absolutePath), { recursive: true });

  if (asset.sourceToken) {
    const result = await run(
      "lark-cli",
      [
        "docs",
        "+media-download",
        "--as",
        "user",
        "--token",
        asset.sourceToken,
        "--output",
        safePath.relativePath
      ],
      workspaceRoot
    );
    assertCommandSucceeded(`download asset ${asset.localPath}`, result);
    return currentBufferHashOrThrow(safePath.absolutePath);
  }

  if (!asset.sourceHref) {
    throw new Error(`Planned asset has neither sourceToken nor sourceHref: ${asset.localPath}`);
  }

  const response = await fetch(asset.sourceHref);
  if (!response.ok) {
    throw new Error(`Failed to fetch asset ${asset.sourceHref}: ${response.status} ${response.statusText}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(safePath.absolutePath, bytes);
  return sha256Buffer(bytes);
}

function plannedDocumentToRemote(
  file: PullPlannedFile,
  proposal: PullProposal,
  fetched: PullFetchedDocument
): PullRemoteDocument {
  return {
    sourceKind: proposal.source.type,
    title: fetched.title || file.title,
    docToken: file.docToken,
    ...(file.wikiNodeToken ? { wikiNodeToken: file.wikiNodeToken } : {}),
    ...(file.sourceUrl ? { sourceUrl: file.sourceUrl } : {}),
    remotePath: file.remotePath
  };
}

function plannedIndexToRemote(
  file: PullPlannedFile,
  proposal: PullProposal,
  fetched: PullFetchedDocument | undefined
): PullRemoteIndex {
  return {
    title: fetched?.title || file.title,
    docToken: file.docToken,
    ...(file.wikiNodeToken ? { wikiNodeToken: file.wikiNodeToken } : {}),
    ...(file.sourceUrl ? { sourceUrl: file.sourceUrl } : {}),
    remotePath: file.remotePath,
    childDocTokens: file.childDocTokens ?? indexChildDocTokens(file, proposal.files)
  };
}

function indexChildDocTokens(indexFile: PullPlannedFile, files: PullPlannedFile[]): string[] {
  const childPrefix = `${indexFile.remotePath.replace(/\/+$/g, "")}/`;
  const directChildren = files
    .filter((file) => file.kind === "document" && file.remotePath.startsWith(childPrefix))
    .map((file) => file.docToken);
  if (directChildren.length > 0) {
    return directChildren;
  }
  return files.filter((file) => file.kind === "document").map((file) => file.docToken);
}

function groupAssetsByOwner(assets: PullPlannedAsset[]): Map<string, PullPlannedAsset[]> {
  const grouped = new Map<string, PullPlannedAsset[]>();
  for (const asset of assets) {
    const existing = grouped.get(asset.ownerDocToken) ?? [];
    existing.push(asset);
    grouped.set(asset.ownerDocToken, existing);
  }
  return grouped;
}

function findFetchedMediaAlt(media: PullFetchedMedia[], asset: PullPlannedAsset): string {
  return media.find((item) =>
    (asset.sourceToken && item.token === asset.sourceToken)
    || (asset.sourceHref && item.href === asset.sourceHref)
    || item.name === asset.name
  )?.alt ?? "";
}

function relativePathFromDocument(documentPath: string, assetPath: string): string {
  return normalizeRelativePath(posix.relative(posix.dirname(documentPath), assetPath));
}

function findPullDocumentState(state: GitYourLarkRootState, file: PullPlannedFile): PullDocumentState | undefined {
  const byPath = state.pull.documents[file.localPath];
  if (byPath?.localPath === file.localPath && byPath.docToken === file.docToken) {
    return byPath;
  }
  return Object.values(state.pull.documents).find((document) =>
    document.localPath === file.localPath && document.docToken === file.docToken
  );
}

function findPullAssetState(state: GitYourLarkRootState, asset: PullPlannedAsset): PullAssetState | undefined {
  const byPath = state.pull.assets[asset.localPath];
  if (byPath?.localPath === asset.localPath && byPath.ownerDocToken === asset.ownerDocToken) {
    return byPath;
  }
  return Object.values(state.pull.assets).find((candidate) =>
    candidate.localPath === asset.localPath && candidate.ownerDocToken === asset.ownerDocToken
  );
}

function nextPullState(state: GitYourLarkRootState): GitYourLarkRootState {
  return {
    ...state,
    publish: {
      ...state.publish,
      documents: { ...state.publish.documents },
      attachments: { ...state.publish.attachments }
    },
    pull: {
      sources: { ...state.pull.sources },
      documents: { ...state.pull.documents },
      assets: { ...state.pull.assets }
    }
  };
}

async function currentTextHash(path: string): Promise<string | undefined> {
  try {
    return sha256Text(await readUtf8(path));
  } catch (error) {
    if (isEnoent(error)) {
      return undefined;
    }
    throw error;
  }
}

async function currentTextHashOrThrow(path: string): Promise<string> {
  return sha256Text(await readUtf8(path));
}

async function currentBufferHash(path: string): Promise<string | undefined> {
  try {
    return sha256Buffer(await readFile(path));
  } catch (error) {
    if (isEnoent(error)) {
      return undefined;
    }
    throw error;
  }
}

async function currentBufferHashOrThrow(path: string): Promise<string> {
  return sha256Buffer(await readFile(path));
}

function safeWorkspacePath(workspaceRoot: string, path: string): SafePath {
  const relativePath = normalizeRelativePath(path);
  const absolutePath = resolve(workspaceRoot, ...relativePath.split("/"));
  const fromRoot = relative(workspaceRoot, absolutePath);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`Path escapes the workspace root: ${path}`);
  }
  return { relativePath, absolutePath };
}

async function createPathSafetyContext(workspaceRoot: string): Promise<PathSafetyContext> {
  const resolvedWorkspaceRoot = resolve(workspaceRoot);
  return {
    realWorkspaceRoot: await realpath(resolvedWorkspaceRoot)
  };
}

async function assertSafeTargetPath(pathSafety: PathSafetyContext, safePath: SafePath): Promise<void> {
  const realExistingPath = await realExistingAncestor(safePath.absolutePath);
  if (!isInsidePath(pathSafety.realWorkspaceRoot, realExistingPath)) {
    throw new Error(`Path escapes the workspace root: ${safePath.relativePath}`);
  }
}

async function realExistingAncestor(path: string): Promise<string> {
  let candidate = path;
  while (true) {
    try {
      return await realpath(candidate);
    } catch (error) {
      if (!isEnoent(error)) {
        throw error;
      }
      const parent = dirname(candidate);
      if (parent === candidate) {
        throw error;
      }
      candidate = parent;
    }
  }
}

function isInsidePath(root: string, target: string): boolean {
  const fromRoot = relative(root, target);
  return fromRoot === "" || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== ".." && !isAbsolute(fromRoot));
}

function normalizeRelativePath(path: string): string {
  const posixPath = path.replace(/\\/g, "/").trim();
  if (!posixPath || posixPath === ".") {
    throw new Error(`Path must be relative to the workspace root: ${path}`);
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

function sanitizePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "-") || "proposal";
}

function requireSafePath<T extends PullPlannedFile | PullPlannedAsset>(paths: Map<T, SafePath>, item: T): SafePath {
  const safePath = paths.get(item);
  if (!safePath) {
    throw new Error(`Missing validated path for ${item.localPath}`);
  }
  return safePath;
}

function isEnoent(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function assertCommandSucceeded(action: string, result: CommandResult): void {
  if (result.code !== 0) {
    throw new Error(`lark-cli failed to ${action}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
}
