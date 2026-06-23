import { access, readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { posix } from "node:path";
import YAML from "yaml";
import { sha256Buffer, sha256Text } from "./hash.js";
import { normalizeLineEndings } from "./fs-utils.js";
import { parseMarkdownAttachments, stripCodeForParsing } from "./markdown-links.js";
import type { GitYourLarkRootState } from "./state.js";

export interface PullVerifyResult {
  ok: boolean;
  problems: string[];
  checkedFiles: string[];
  checkedAssets: string[];
}

interface SafePath {
  relativePath: string;
  absolutePath: string;
}

interface GylFrontmatter {
  token?: unknown;
  title?: unknown;
  pulled_at?: unknown;
}

export async function verifyPullWorkspace(input: {
  workspaceRoot: string;
  state: GitYourLarkRootState;
}): Promise<PullVerifyResult> {
  const workspaceRoot = resolve(input.workspaceRoot);
  const realWorkspaceRoot = await realpath(workspaceRoot);
  const problems: string[] = [];
  const checkedFiles: string[] = [];
  const checkedAssets = new Set<string>();
  const knownStems = knownPulledStems(input.state);
  const verifyWikiLinks = hasCollectionSource(input.state);

  for (const document of Object.values(input.state.pull.documents)) {
    const filePath = safeWorkspacePathProblem(document.localPath, workspaceRoot);
    checkedFiles.push(filePath.relativePath);
    if (filePath.problem) {
      problems.push(filePath.problem);
      continue;
    }

    if (!(await pathExists(filePath.absolutePath))) {
      problems.push(`Missing pulled Markdown file: ${filePath.relativePath}`);
      continue;
    }

    const fileProblem = await assertExistingPathInsideWorkspace(realWorkspaceRoot, filePath);
    if (fileProblem) {
      problems.push(fileProblem);
      continue;
    }

    const markdown = await readFile(filePath.absolutePath, "utf8");
    if (sha256Text(markdown) !== document.localHash) {
      problems.push(`Pulled Markdown hash differs from state: ${filePath.relativePath}`);
    }
    problems.push(...verifyFrontmatter(markdown, filePath.relativePath));

    if (markdown.includes("internal-api-drive-stream.feishu.cn")) {
      problems.push(`Generated Markdown contains unreplaced Feishu stream URL: ${filePath.relativePath}`);
    }

    const assetPaths = referencedAssetPaths(filePath.relativePath, markdown);
    for (const assetPath of [...document.assetPaths, ...assetPaths]) {
      const assetProblem = await verifyAssetPath(workspaceRoot, realWorkspaceRoot, assetPath, filePath.relativePath);
      checkedAssets.add(assetProblem.relativePath);
      if (assetProblem.problem) {
        problems.push(assetProblem.problem);
      }
    }

    if (verifyWikiLinks) {
      for (const link of scanWikiLinks(markdown)) {
        const stem = wikiTargetStem(link.target);
        if (stem && !knownStems.has(stem)) {
          problems.push(
            `Wiki link in pulled collection points outside known pulled documents: ${filePath.relativePath} -> ${link.target}`
          );
        }
      }
    }
  }

  for (const asset of Object.values(input.state.pull.assets)) {
    const assetProblem = await verifyAssetPath(workspaceRoot, realWorkspaceRoot, asset.localPath, undefined, asset.hash);
    checkedAssets.add(assetProblem.relativePath);
    if (assetProblem.problem) {
      problems.push(assetProblem.problem);
    }
  }

  return {
    ok: problems.length === 0,
    problems,
    checkedFiles,
    checkedAssets: [...checkedAssets]
  };
}

function verifyFrontmatter(markdown: string, localPath: string): string[] {
  const problems: string[] = [];
  const frontmatter = parseFrontmatter(markdown, localPath, problems);
  const gyl = frontmatter?.gyl;

  if (!isRecord(gyl)) {
    for (const field of ["token", "title", "pulled_at"]) {
      problems.push(`Missing required gyl.${field} frontmatter in pulled Markdown: ${localPath}`);
    }
    return problems;
  }

  for (const field of ["token", "title", "pulled_at"] as const) {
    if (!hasRequiredValue(gyl[field])) {
      problems.push(`Missing required gyl.${field} frontmatter in pulled Markdown: ${localPath}`);
    }
  }
  return problems;
}

function parseFrontmatter(markdown: string, localPath: string, problems: string[]): Record<string, unknown> | undefined {
  const normalized = normalizeLineEndings(markdown);
  if (!normalized.startsWith("---\n")) {
    problems.push(`Missing YAML frontmatter in pulled Markdown: ${localPath}`);
    return undefined;
  }

  const end = normalized.indexOf("\n---", 4);
  if (end === -1) {
    problems.push(`Missing closing YAML frontmatter marker in pulled Markdown: ${localPath}`);
    return undefined;
  }

  try {
    const parsed = YAML.parse(normalized.slice(4, end));
    return isRecord(parsed) ? parsed : undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    problems.push(`Invalid YAML frontmatter in pulled Markdown: ${localPath}: ${message}`);
    return undefined;
  }
}

function referencedAssetPaths(documentPath: string, markdown: string): string[] {
  const targets = [
    ...parseMarkdownAttachments(markdown).map((attachment) => attachment.target),
    ...parseRegularLocalFileLinks(markdown).map((link) => link.target)
  ];

  return targets.map((target) => resolveMarkdownTarget(documentPath, target));
}

async function verifyAssetPath(
  workspaceRoot: string,
  realWorkspaceRoot: string,
  localPath: string,
  ownerDocumentPath?: string,
  expectedHash?: string
): Promise<{ relativePath: string; problem?: string }> {
  try {
    const safePath = safeWorkspacePath(workspaceRoot, localPath);
    const missingMessage = ownerDocumentPath
      ? `Missing local asset referenced by ${ownerDocumentPath}: ${safePath.relativePath}`
      : `Missing pulled asset file: ${safePath.relativePath}`;

    if (!(await pathExists(safePath.absolutePath))) {
      return { relativePath: safePath.relativePath, problem: missingMessage };
    }

    const problem = await assertExistingPathInsideWorkspace(realWorkspaceRoot, safePath);
    if (problem) {
      return { relativePath: safePath.relativePath, problem };
    }
    const stats = await stat(safePath.absolutePath);
    if (!stats.isFile()) {
      return { relativePath: safePath.relativePath, problem: `Pulled asset path is not a file: ${safePath.relativePath}` };
    }
    if (expectedHash && sha256Buffer(await readFile(safePath.absolutePath)) !== expectedHash) {
      return { relativePath: safePath.relativePath, problem: `Pulled asset hash differs from state: ${safePath.relativePath}` };
    }
    return { relativePath: safePath.relativePath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { relativePath: localPath.replace(/\\/g, "/"), problem: message };
  }
}

function safeWorkspacePathProblem(path: string, workspaceRoot: string): SafePath & { problem?: string } {
  try {
    return safeWorkspacePath(workspaceRoot, path);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      relativePath: path.replace(/\\/g, "/"),
      absolutePath: "",
      problem: message
    };
  }
}

async function assertExistingPathInsideWorkspace(realWorkspaceRoot: string, safePath: SafePath): Promise<string | undefined> {
  const realTarget = await realpath(safePath.absolutePath);
  if (!isInsidePath(realWorkspaceRoot, realTarget)) {
    return `Path escapes the workspace root: ${safePath.relativePath}`;
  }
  return undefined;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function scanWikiLinks(markdown: string): Array<{ target: string }> {
  const source = stripCodeForParsing(markdown);
  const links: Array<{ target: string }> = [];
  for (const match of source.matchAll(/(?<!!)\[\[([^\]\n]+)\]\]/g)) {
    const target = match[1].split("|", 1)[0].split("#", 1)[0].trim();
    if (target) {
      links.push({ target });
    }
  }
  return links;
}

function parseRegularLocalFileLinks(markdown: string): Array<{ target: string }> {
  const source = stripCodeForParsing(markdown);
  const links: Array<{ target: string }> = [];

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "!" && source[index + 1] === "[") {
      continue;
    }
    if (source[index] !== "[" || source[index - 1] === "!") {
      continue;
    }

    const labelEnd = source.indexOf("]", index + 1);
    if (labelEnd === -1 || source[labelEnd + 1] !== "(") {
      continue;
    }

    const destinationStart = labelEnd + 2;
    const destinationEnd = findMarkdownDestinationEnd(source, destinationStart);
    if (destinationEnd === -1) {
      continue;
    }

    const target = normalizeRegularLinkTarget(source.slice(destinationStart, destinationEnd));
    if (target && !target.toLowerCase().endsWith(".md")) {
      links.push({ target });
    }
    index = destinationEnd;
  }

  return links;
}

function normalizeRegularLinkTarget(value: string): string | undefined {
  const trimmed = value.trim();
  const withoutAngleBrackets = trimmed.startsWith("<") && trimmed.includes(">") ? trimmed.slice(1, trimmed.indexOf(">")) : trimmed;
  const target = stripMarkdownLinkTitle(withoutAngleBrackets).split("#", 1)[0].trim();
  if (!target || target.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(target)) {
    return undefined;
  }
  return target;
}

function stripMarkdownLinkTitle(destination: string): string {
  const quotedTitle = destination.match(/^(.+\.[^\s.]+)\s+(?:"[^"]*"|'[^']*')\s*$/);
  if (quotedTitle) {
    return quotedTitle[1];
  }

  const parenthesizedTitle = destination.match(/^(.+\.[^\s.]+)\s+\([^()]*\)\s*$/);
  if (parenthesizedTitle) {
    return parenthesizedTitle[1];
  }

  return destination;
}

function findMarkdownDestinationEnd(source: string, start: number): number {
  let depth = 0;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\n") {
      return -1;
    }
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      if (depth === 0) {
        return index;
      }
      depth -= 1;
    }
  }

  return -1;
}

function resolveMarkdownTarget(documentPath: string, target: string): string {
  const normalizedTarget = target.replace(/\\/g, "/");
  if (posix.isAbsolute(normalizedTarget) || /^[A-Za-z]:/.test(normalizedTarget)) {
    return normalizedTarget;
  }
  const documentDir = posix.dirname(documentPath.replace(/\\/g, "/"));
  return documentDir === "." ? normalizedTarget : `${documentDir}/${normalizedTarget}`;
}

function knownPulledStems(state: GitYourLarkRootState): Set<string> {
  return new Set(Object.values(state.pull.documents).map((document) => stemFromMarkdownPath(document.localPath)));
}

function stemFromMarkdownPath(localPath: string): string {
  const basename = posix.basename(localPath.replace(/\\/g, "/"));
  return basename.toLowerCase().endsWith(".md") ? basename.slice(0, -3) : basename;
}

function wikiTargetStem(target: string): string {
  return stemFromMarkdownPath(posix.basename(target.replace(/\\/g, "/")));
}

function hasCollectionSource(state: GitYourLarkRootState): boolean {
  return Object.values(state.pull.sources).some((source) => source.type === "folder" || source.type === "wiki_node");
}

function hasRequiredValue(value: unknown): boolean {
  return typeof value === "string" ? value.trim().length > 0 : Boolean(value);
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

function isInsidePath(root: string, target: string): boolean {
  const fromRoot = relative(root, target);
  return fromRoot === "" || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== ".." && !isAbsolute(fromRoot));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
