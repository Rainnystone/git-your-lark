import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { posix } from "node:path";

export interface SafePath {
  relativePath: string;
  absolutePath: string;
}

/**
 * Deep module owning workspace path-safety for git-your-lark.
 *
 * One `create` resolves the workspace root through `realpath` once (an explicit
 * promise by the caller about what "the workspace" is at that moment). The two
 * methods then enforce that every resolved path stays inside that root:
 *
 * - `safeWorkspacePath` (write semantics): the leaf need not exist yet, but any
 *   escape — a literal `../` traversal or a symlink whose realpath leaves the
 *   workspace — throws. Used when the caller will create/replace the target.
 * - `safeWorkspacePathIfExists` (read semantics): escape or a missing leaf
 *   resolves to `undefined`, so callers that scan optional files can treat both
 *   as "not safely available" without distinguishing. This is what closes the
 *   symlink-escape leak in the publish scan: an attachment that symlinks
 *   outside the workspace is no longer hashed and uploaded.
 *
 * Malformed input (empty, absolute, drive-letter) always throws from both
 * methods — it is not a path at all, not a containment question.
 */
export class WorkspacePaths {
  private constructor(private readonly realWorkspaceRoot: string) {}

  static async create(workspaceRoot: string): Promise<WorkspacePaths> {
    const realWorkspaceRoot = await realpath(resolve(workspaceRoot));
    return new WorkspacePaths(realWorkspaceRoot);
  }

  async safeWorkspacePath(rel: string): Promise<SafePath> {
    const normalized = normalizeRelativePath(rel);
    const absolutePath = resolve(this.realWorkspaceRoot, ...normalized.split("/"));
    const realAncestor = await realExistingAncestor(absolutePath);
    if (!isInsidePath(this.realWorkspaceRoot, realAncestor)) {
      throw new Error(`Path escapes the workspace root: ${rel}`);
    }
    return { relativePath: normalized, absolutePath };
  }

  async safeWorkspacePathIfExists(rel: string): Promise<SafePath | undefined> {
    const normalized = tryNormalizeRelativePath(rel);
    if (normalized === undefined) {
      return undefined;
    }
    const absolutePath = resolve(this.realWorkspaceRoot, ...normalized.split("/"));
    let realTarget: string;
    try {
      realTarget = await realpath(absolutePath);
    } catch (error) {
      if (isEnoent(error)) {
        return undefined;
      }
      throw error;
    }
    if (!isInsidePath(this.realWorkspaceRoot, realTarget)) {
      return undefined;
    }
    return { relativePath: normalized, absolutePath };
  }
}

/**
 * Normalize a workspace-relative path. Throws on malformed input (empty,
 * absolute, drive-letter) and on a `../` traversal that escapes the root.
 */
function normalizeRelativePath(path: string): string {
  const normalized = tryNormalizeRelativePath(path);
  if (normalized === undefined) {
    throw new Error(`Path escapes the workspace root: ${path}`);
  }
  return normalized;
}

/**
 * Like `normalizeRelativePath` but returns `undefined` for a `../` escape
 * instead of throwing, so the read variant can treat escape as "not available".
 * Malformed input still throws — it is not a containment question.
 */
function tryNormalizeRelativePath(path: string): string | undefined {
  const posixPath = path.replace(/\\/g, "/").trim();
  if (!posixPath || posixPath === ".") {
    throw new Error(`Path must be relative to the workspace root: ${path}`);
  }
  if (posix.isAbsolute(posixPath) || /^[A-Za-z]:/.test(posixPath)) {
    throw new Error(`Path must be relative to the workspace root: ${path}`);
  }
  const normalized = posix.normalize(posixPath).replace(/^\.\//, "");
  if (normalized === ".." || normalized.startsWith("../")) {
    return undefined;
  }
  return normalized;
}

/**
 * Resolve the longest existing ancestor of `path` through `realpath`, so a
 * not-yet-existing leaf can still be containment-checked against its existing
 * ancestor. This lets the write variant accept a target that will be created.
 */
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

function isEnoent(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as { code?: unknown }).code === "ENOENT";
}
