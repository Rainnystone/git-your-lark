import { posix } from "node:path";
import { sha256Text } from "./hash.js";
import type { PullFetchedDocument, PullFetchedMedia } from "./pull-fetch.js";
import {
  cleanMarkdownFilename,
  renderPullIndexMarkdown,
  renderPullMarkdown,
  type PullLinkTarget,
  type PullMediaPlan
} from "./pull-render.js";
import type { PullRemoteDocument, PullRemoteIndex, PullScanResult, PullScanWarning } from "./pull-types.js";
import type { GitYourLarkRootState, PullAssetState, PullDocumentState } from "./state.js";

export interface PullProposal {
  id: string;
  createdAt: string;
  source: {
    type: "doc" | "folder" | "wiki_node";
    tokenOrUrl: string;
    title?: string;
  };
  files: PullPlannedFile[];
  assets: PullPlannedAsset[];
  blockers: string[];
  warnings: string[];
}

export interface PullPlannedFile {
  kind: "document" | "index";
  title: string;
  docToken: string;
  wikiNodeToken?: string;
  sourceUrl?: string;
  remotePath: string;
  localPath: string;
  expectedRevisionId?: string;
  expectedLocalHash?: string;
  contentHash?: string;
}

export interface PullPlannedAsset {
  ownerDocToken: string;
  kind: "image" | "file";
  name: string;
  sourceToken?: string;
  sourceHref?: string;
  localPath: string;
  expectedLocalHash?: string;
}

export interface PullNamingRule {
  match: {
    title?: string;
    token?: string;
    wikiNodeToken?: string;
  };
  localPath: string;
}

export interface PullProposalConfig {
  outputDir: string;
  namingRules?: PullNamingRule[];
  assetPolicy?: {
    mode?: "per-document-folder";
    directoryName?: string;
  };
}

export interface PlanPullPathsInput {
  scan: PullScanResult;
  outputDir: string;
  namingRules?: PullNamingRule[];
}

export interface BuildPullProposalInput {
  scan: PullScanResult;
  fetchedDocuments: Map<string, PullFetchedDocument> | Record<string, PullFetchedDocument>;
  state: GitYourLarkRootState;
  pull: PullProposalConfig;
  existingLocalFiles?: Map<string, string> | Record<string, string>;
  now?: Date | string;
}

export function buildPullProposal(input: BuildPullProposalInput): PullProposal {
  const createdAt = toIsoString(input.now);
  const warnings = input.scan.warnings.map(renderScanWarning);
  const blockers: string[] = [];
  const fetchedDocuments = toFetchedDocumentMap(input.fetchedDocuments);
  const files = planPullPaths({
    scan: input.scan,
    outputDir: input.pull.outputDir,
    namingRules: input.pull.namingRules ?? []
  });
  const filesByDocToken = new Map(files.map((file) => [file.docToken, file]));
  const existingLocalFiles = toExistingLocalFiles(input.existingLocalFiles);
  const linkIndex = buildPullLinkIndex(files);
  const assets: PullPlannedAsset[] = [];
  const assetDirectoryName = normalizeRelativePath(input.pull.assetPolicy?.directoryName ?? "assets");

  for (const duplicatePath of findDuplicateLocalPaths(files)) {
    blockers.push(`Multiple remote documents map to the same local path: ${duplicatePath}`);
  }

  for (const file of files) {
    const currentLocalHash = existingLocalFiles.get(file.localPath);
    const documentState = findPullDocumentState(input.state, file);
    if (currentLocalHash !== undefined) {
      if (!documentState) {
        blockers.push(`Existing local file is not owned by pull state: ${file.localPath}`);
      } else if (documentState.localHash !== currentLocalHash) {
        blockers.push(`Existing pull-owned file has local changes since last pull: ${file.localPath}`);
      } else {
        file.expectedLocalHash = documentState.localHash;
      }
    }

    if (file.kind !== "document") {
      continue;
    }

    const fetched = fetchedDocuments.get(file.docToken);
    if (!fetched) {
      blockers.push(`Fetched document is missing for planned file: ${file.docToken}`);
      continue;
    }

    file.expectedRevisionId = fetched.revisionId;
    const documentAssets = planDocumentAssets(file, fetched.media, assetDirectoryName);
    assets.push(...documentAssets);

    const mediaPlans = documentAssets.map((asset): PullMediaPlan => ({
      kind: asset.kind,
      name: asset.name,
      alt: findFetchedMediaAlt(fetched.media, asset),
      ...(asset.sourceToken ? { sourceToken: asset.sourceToken } : {}),
      ...(asset.sourceHref ? { sourceHref: asset.sourceHref } : {}),
      localPath: relativePathFromDocument(file.localPath, asset.localPath)
    }));
    const remote = input.scan.documents.find((document) => document.docToken === file.docToken);
    if (remote) {
      file.contentHash = sha256Text(
        renderPullMarkdown({
          markdown: fetched.markdown,
          remote: {
            ...remote,
            title: fetched.title || remote.title
          },
          plannedPath: file.localPath,
          index: linkIndex,
          mediaPlans,
          pulledAt: createdAt
        }).markdown
      );
    }
  }

  for (const duplicatePath of findDuplicateLocalPaths(assets)) {
    blockers.push(`Multiple remote assets map to the same local path: ${duplicatePath}`);
  }

  for (const asset of assets) {
    const currentLocalHash = existingLocalFiles.get(asset.localPath);
    const assetState = findPullAssetState(input.state, asset);
    if (currentLocalHash === undefined) {
      continue;
    }
    if (!assetState) {
      blockers.push(`Existing local asset is not owned by pull state: ${asset.localPath}`);
    } else if (assetState.hash !== currentLocalHash) {
      blockers.push(`Existing pull-owned asset has local changes since last pull: ${asset.localPath}`);
    } else {
      asset.expectedLocalHash = assetState.hash;
    }
  }

  for (const file of files) {
    if (file.kind !== "index") {
      continue;
    }

    const index = input.scan.indexes.find((candidate) => candidate.docToken === file.docToken);
    if (!index) {
      continue;
    }
    file.contentHash = sha256Text(
      renderPullIndexMarkdown({
        remote: index,
        plannedPath: file.localPath,
        index: linkIndex,
        pulledAt: createdAt
      })
    );
  }

  for (const fetched of fetchedDocuments.values()) {
    if (!filesByDocToken.has(fetched.docToken)) {
      warnings.push(`Fetched document not present in scan result: ${fetched.docToken}`);
    }
  }

  return {
    id: proposalId(createdAt),
    createdAt,
    source: input.scan.source,
    files,
    assets,
    blockers,
    warnings
  };
}

export function renderPullProposalMarkdown(proposal: PullProposal): string {
  return [
    `# Pull Proposal ${proposal.id}`,
    "",
    `Created: ${proposal.createdAt}`,
    "",
    "## Source",
    `- Type: ${proposal.source.type}`,
    `- Token or URL: ${proposal.source.tokenOrUrl}`,
    ...(proposal.source.title ? [`- Title: ${proposal.source.title}`] : []),
    "",
    "## Actions",
    renderList([
      ...proposal.files.map((file) => `write ${file.kind} ${file.localPath}`),
      ...proposal.assets.map((asset) => `download ${asset.kind} ${asset.localPath}`)
    ]),
    "",
    "## Blockers",
    renderList(proposal.blockers),
    "",
    "## Warnings",
    renderList(proposal.warnings),
    "",
    "## Planned Files",
    renderList(proposal.files.map((file) => `${file.kind} ${file.title} -> ${file.localPath}`)),
    "",
    "## Planned Assets",
    renderList(proposal.assets.map((asset) => `${asset.kind} ${asset.name} -> ${asset.localPath}`)),
    ""
  ].join("\n");
}

export function proposalId(createdAt: string): string {
  return `pull-proposal-${createdAt.replace(/[:.]/g, "-")}`;
}

export function planPullPaths(input: PlanPullPathsInput): PullPlannedFile[] {
  const outputDir = normalizeRelativePath(input.outputDir);
  const namingRules = (input.namingRules ?? []).map((rule) => ({
    ...rule,
    localPath: normalizeRelativePath(rule.localPath)
  }));

  if (input.scan.source.type === "doc") {
    return input.scan.documents.map((document) => documentToPlannedFile(document, defaultSingleDocPath(outputDir, document), namingRules, outputDir));
  }

  const sourceTitle = input.scan.source.title ?? input.scan.indexes[0]?.title ?? input.scan.documents[0]?.remotePath.split("/")[0] ?? "pull";
  const sourceRoot = joinRelative(outputDir, cleanMarkdownFilename(sourceTitle));
  const files: PullPlannedFile[] = [];

  for (const index of input.scan.indexes) {
    files.push(indexToPlannedFile(index, defaultIndexPath(sourceRoot, sourceTitle, index)));
  }

  for (const document of input.scan.documents) {
    files.push(documentToPlannedFile(document, defaultCollectionDocumentPath(sourceRoot, sourceTitle, document), namingRules, outputDir));
  }

  return files;
}

export function buildPullLinkIndex(files: PullPlannedFile[]): Map<string, PullLinkTarget> {
  const index = new Map<string, PullLinkTarget>();
  for (const file of files) {
    const target = {
      stem: markdownStem(file.localPath),
      localPath: file.localPath
    };
    index.set(file.docToken, target);
    if (file.wikiNodeToken) {
      index.set(file.wikiNodeToken, target);
    }
  }
  return index;
}

function documentToPlannedFile(
  document: PullRemoteDocument,
  defaultLocalPath: string,
  namingRules: PullNamingRule[],
  outputDir: string
): PullPlannedFile {
  const rule = namingRules.find((candidate) => matchesNamingRule(candidate, document));
  const localPath = rule ? joinRelative(outputDir, rule.localPath) : defaultLocalPath;
  return {
    kind: "document",
    title: document.title,
    docToken: document.docToken,
    ...(document.wikiNodeToken ? { wikiNodeToken: document.wikiNodeToken } : {}),
    ...(document.sourceUrl ? { sourceUrl: document.sourceUrl } : {}),
    remotePath: document.remotePath,
    localPath
  };
}

function indexToPlannedFile(index: PullRemoteIndex, localPath: string): PullPlannedFile {
  return {
    kind: "index",
    title: index.title,
    docToken: index.docToken,
    ...(index.wikiNodeToken ? { wikiNodeToken: index.wikiNodeToken } : {}),
    ...(index.sourceUrl ? { sourceUrl: index.sourceUrl } : {}),
    remotePath: index.remotePath,
    localPath
  };
}

function defaultSingleDocPath(outputDir: string, document: PullRemoteDocument): string {
  return joinRelative(outputDir, `${cleanMarkdownFilename(document.title)}.md`);
}

function defaultCollectionDocumentPath(sourceRoot: string, sourceTitle: string, document: PullRemoteDocument): string {
  const relativeSegments = relativeRemoteSegments(document.remotePath, sourceTitle);
  if (relativeSegments.length === 0) {
    relativeSegments.push(document.title);
  }
  return joinRelative(sourceRoot, ...withMarkdownExtension(relativeSegments));
}

function defaultIndexPath(sourceRoot: string, sourceTitle: string, index: PullRemoteIndex): string {
  const relativeSegments = relativeRemoteSegments(index.remotePath, sourceTitle);
  if (relativeSegments.length === 0) {
    return joinRelative(sourceRoot, `${cleanMarkdownFilename(sourceTitle)}.md`);
  }
  return joinRelative(sourceRoot, ...relativeSegments.map(cleanMarkdownFilename), `${cleanMarkdownFilename(relativeSegments.at(-1) ?? index.title)}.md`);
}

function relativeRemoteSegments(remotePath: string, sourceTitle: string): string[] {
  const segments = remotePath.split("/").filter(Boolean);
  if (segments[0] === sourceTitle) {
    return segments.slice(1).map(cleanMarkdownFilename);
  }
  return segments.map(cleanMarkdownFilename);
}

function withMarkdownExtension(segments: string[]): string[] {
  return segments.map((segment, index) => (index === segments.length - 1 ? `${cleanMarkdownFilename(segment)}.md` : cleanMarkdownFilename(segment)));
}

function matchesNamingRule(rule: PullNamingRule, document: PullRemoteDocument): boolean {
  return Boolean(
    (rule.match.title && rule.match.title === document.title)
      || (rule.match.token && rule.match.token === document.docToken)
      || (rule.match.wikiNodeToken && rule.match.wikiNodeToken === document.wikiNodeToken)
  );
}

function planDocumentAssets(
  file: PullPlannedFile,
  media: PullFetchedMedia[],
  assetDirectoryName: string
): PullPlannedAsset[] {
  const paths = new Set<string>();
  return media.map((item) => {
    const name = cleanAssetName(item);
    const localPath = uniquePath(
      joinRelative(posix.dirname(file.localPath), assetDirectoryName, markdownStem(file.localPath), name),
      paths
    );
    return {
      ownerDocToken: file.docToken,
      kind: item.kind,
      name,
      ...(item.token ? { sourceToken: item.token } : {}),
      ...(item.href ? { sourceHref: item.href } : {}),
      localPath
    };
  });
}

function cleanAssetName(media: PullFetchedMedia): string {
  const fallback = media.token ?? media.href?.split(/[/?#]/).filter(Boolean).at(-1) ?? media.kind;
  return cleanMarkdownFilename((media.name || fallback).split(/[\\/]/).at(-1) ?? fallback);
}

function uniquePath(path: string, seen: Set<string>): string {
  if (!seen.has(path)) {
    seen.add(path);
    return path;
  }

  const extension = posix.extname(path);
  const base = path.slice(0, extension ? -extension.length : undefined);
  let index = 2;
  let candidate = `${base}-${index}${extension}`;
  while (seen.has(candidate)) {
    index += 1;
    candidate = `${base}-${index}${extension}`;
  }
  seen.add(candidate);
  return candidate;
}

function findFetchedMediaAlt(media: PullFetchedMedia[], asset: PullPlannedAsset): string {
  return media.find((item) => item.token === asset.sourceToken || item.href === asset.sourceHref || item.name === asset.name)?.alt ?? "";
}

function relativePathFromDocument(documentPath: string, assetPath: string): string {
  const relative = posix.relative(posix.dirname(documentPath), assetPath);
  return normalizeRelativePath(relative);
}

function findDuplicateLocalPaths(items: { localPath: string }[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const item of items) {
    if (seen.has(item.localPath)) {
      duplicates.add(item.localPath);
    }
    seen.add(item.localPath);
  }
  return [...duplicates];
}

function findPullDocumentState(state: GitYourLarkRootState, file: PullPlannedFile): PullDocumentState | undefined {
  const byPath = state.pull.documents[file.localPath];
  if (byPath?.localPath === file.localPath && byPath.docToken === file.docToken) {
    return byPath;
  }
  return Object.values(state.pull.documents).find((document) =>
    document.docToken === file.docToken && document.localPath === file.localPath
  );
}

function findPullAssetState(state: GitYourLarkRootState, asset: PullPlannedAsset): PullAssetState | undefined {
  const byPath = state.pull.assets[asset.localPath];
  if (byPath?.localPath === asset.localPath && byPath.ownerDocToken === asset.ownerDocToken) {
    return byPath;
  }
  return Object.values(state.pull.assets).find((candidate) =>
    candidate.ownerDocToken === asset.ownerDocToken && candidate.localPath === asset.localPath
  );
}

function toFetchedDocumentMap(
  value: Map<string, PullFetchedDocument> | Record<string, PullFetchedDocument>
): Map<string, PullFetchedDocument> {
  if (value instanceof Map) {
    return value;
  }
  return new Map(Object.entries(value));
}

function toExistingLocalFiles(value: Map<string, string> | Record<string, string> | undefined): Map<string, string> {
  if (!value) {
    return new Map();
  }
  if (value instanceof Map) {
    return new Map([...value.entries()].map(([path, hash]) => [normalizeRelativePath(path), hash]));
  }
  return new Map(Object.entries(value).map(([path, hash]) => [normalizeRelativePath(path), hash]));
}

function renderScanWarning(warning: PullScanWarning): string {
  return warning.message;
}

function renderList(items: string[]): string {
  if (items.length === 0) {
    return "- None";
  }
  return items.map((item) => `- ${item}`).join("\n");
}

function markdownStem(path: string): string {
  const basename = posix.basename(path);
  return basename.endsWith(".md") ? basename.slice(0, -3) : basename;
}

function joinRelative(...parts: string[]): string {
  return normalizeRelativePath(posix.join(...parts.filter((part) => part !== "")));
}

function normalizeRelativePath(path: string): string {
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

function toIsoString(value: Date | string | undefined): string {
  if (typeof value === "string") {
    return value;
  }
  return (value ?? new Date()).toISOString();
}
