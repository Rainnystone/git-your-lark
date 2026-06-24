import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WorkspacePaths } from "../../scripts/lib/workspace-paths.js";
import { canCreateSymlink } from "./helpers/symlink-support.js";

async function makeWorkspace(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "gyl-workspace-paths-")));
  await mkdir(join(root, "docs", "assets"), { recursive: true });
  await writeFile(join(root, "docs", "note.md"), "# note\n", "utf8");
  await writeFile(join(root, "docs", "assets", "logo.png"), "png-bytes", "utf8");
  return root;
}

async function makeTempDir(prefix: string): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), prefix)));
}

describe("WorkspacePaths.create", () => {
  it("resolves the workspace root through symlinks once at construction", async () => {
    const realRoot = await makeWorkspace();
    const parent = await makeTempDir("gyl-wp-parent-");
    const linkedRoot = join(parent, "linked-root");
    await symlink(realRoot, linkedRoot, "dir");

    const paths = await WorkspacePaths.create(linkedRoot);
    // A file inside the real root is reachable through the linked root.
    const safe = await paths.safeWorkspacePath("docs/note.md");
    expect(safe.relativePath).toBe("docs/note.md");
    // absolutePath is anchored to the resolved (real) root.
    expect(safe.absolutePath).toBe(join(realRoot, "docs", "note.md"));
  });
});

describe("WorkspacePaths.safeWorkspacePath (write semantics)", () => {
  it("returns a safe path for an existing inside-workspace file", async () => {
    const root = await makeWorkspace();
    const paths = await WorkspacePaths.create(root);

    const safe = await paths.safeWorkspacePath("docs/note.md");
    expect(safe.relativePath).toBe("docs/note.md");
    expect(safe.absolutePath).toBe(join(root, "docs", "note.md"));
  });

  it("returns a safe path for a not-yet-existing leaf whose ancestor is inside", async () => {
    const root = await makeWorkspace();
    const paths = await WorkspacePaths.create(root);

    const safe = await paths.safeWorkspacePath("docs/new-file.md");
    expect(safe.relativePath).toBe("docs/new-file.md");
    expect(safe.absolutePath).toBe(join(root, "docs", "new-file.md"));
  });

  it("normalizes backslashes and inner traversal to an inside path", async () => {
    const root = await makeWorkspace();
    const paths = await WorkspacePaths.create(root);

    const safe = await paths.safeWorkspacePath("docs\\..\\docs\\note.md");
    expect(safe.relativePath).toBe("docs/note.md");
  });

  it("throws on a literal parent-traversal escape", async () => {
    const root = await makeWorkspace();
    const paths = await WorkspacePaths.create(root);

    await expect(paths.safeWorkspacePath("../outside.md")).rejects.toThrow(/escapes the workspace root/);
  });

  it("throws on an absolute path", async () => {
    const root = await makeWorkspace();
    const paths = await WorkspacePaths.create(root);

    await expect(paths.safeWorkspacePath("/etc/passwd")).rejects.toThrow(/relative to the workspace root/);
  });

  it("throws on a drive-letter path", async () => {
    const root = await makeWorkspace();
    const paths = await WorkspacePaths.create(root);

    await expect(paths.safeWorkspacePath("C:/tmp/x.md")).rejects.toThrow(/relative to the workspace root/);
  });

  it("throws on an empty path", async () => {
    const root = await makeWorkspace();
    const paths = await WorkspacePaths.create(root);

    await expect(paths.safeWorkspacePath("")).rejects.toThrow(/relative to the workspace root/);
  });

  it.skipIf(!canCreateSymlink())("throws when a symlinked directory resolves outside the workspace", async () => {
    const root = await makeWorkspace();
    const external = await makeTempDir("gyl-wp-external-");
    await symlink(external, join(root, "docs", "linked"), "dir");
    const paths = await WorkspacePaths.create(root);

    await expect(paths.safeWorkspacePath("docs/linked/secret.md")).rejects.toThrow(/escapes the workspace root/);
  });

  it.skipIf(!canCreateSymlink())("accepts a symlinked directory that resolves inside the workspace", async () => {
    const root = await makeWorkspace();
    await mkdir(join(root, "real-assets"), { recursive: true });
    await writeFile(join(root, "real-assets", "x.png"), "x", "utf8");
    await symlink(join(root, "real-assets"), join(root, "docs", "linked-assets"), "dir");
    const paths = await WorkspacePaths.create(root);

    const safe = await paths.safeWorkspacePath("docs/linked-assets/x.png");
    expect(safe.relativePath).toBe("docs/linked-assets/x.png");
  });
});

describe("WorkspacePaths.safeWorkspacePathIfExists (read semantics)", () => {
  it("returns a safe path for an existing inside-workspace file", async () => {
    const root = await makeWorkspace();
    const paths = await WorkspacePaths.create(root);

    const safe = await paths.safeWorkspacePathIfExists("docs/note.md");
    expect(safe?.relativePath).toBe("docs/note.md");
    expect(safe?.absolutePath).toBe(join(root, "docs", "note.md"));
  });

  it("returns undefined for a missing file", async () => {
    const root = await makeWorkspace();
    const paths = await WorkspacePaths.create(root);

    const safe = await paths.safeWorkspacePathIfExists("docs/missing.md");
    expect(safe).toBeUndefined();
  });

  it("returns undefined for a literal parent-traversal escape", async () => {
    const root = await makeWorkspace();
    const paths = await WorkspacePaths.create(root);

    const safe = await paths.safeWorkspacePathIfExists("../outside.md");
    expect(safe).toBeUndefined();
  });

  it("normalizes inner traversal before deciding containment", async () => {
    const root = await makeWorkspace();
    const paths = await WorkspacePaths.create(root);

    const safe = await paths.safeWorkspacePathIfExists("docs/../docs/note.md");
    expect(safe?.relativePath).toBe("docs/note.md");
  });

  it("throws on malformed input (absolute path)", async () => {
    const root = await makeWorkspace();
    const paths = await WorkspacePaths.create(root);

    await expect(paths.safeWorkspacePathIfExists("/etc/passwd")).rejects.toThrow(/relative to the workspace root/);
  });

  it("throws on malformed input (empty path)", async () => {
    const root = await makeWorkspace();
    const paths = await WorkspacePaths.create(root);

    await expect(paths.safeWorkspacePathIfExists("")).rejects.toThrow(/relative to the workspace root/);
  });

  it.skipIf(!canCreateSymlink())("returns undefined when a symlink resolves outside the workspace", async () => {
    const root = await makeWorkspace();
    const external = await makeTempDir("gyl-wp-ext-read-");
    await writeFile(join(external, "secret.png"), "secret", "utf8");
    await symlink(join(external, "secret.png"), join(root, "docs", "assets", "leak.png"), "file");
    const paths = await WorkspacePaths.create(root);

    const safe = await paths.safeWorkspacePathIfExists("docs/assets/leak.png");
    expect(safe).toBeUndefined();
  });

  it.skipIf(!canCreateSymlink())("returns a safe path for a symlink that resolves inside the workspace", async () => {
    const root = await makeWorkspace();
    await symlink(join(root, "docs", "assets", "logo.png"), join(root, "docs", "alias.png"), "file");
    const paths = await WorkspacePaths.create(root);

    const safe = await paths.safeWorkspacePathIfExists("docs/alias.png");
    expect(safe?.relativePath).toBe("docs/alias.png");
  });
});

describe("WorkspacePaths relativePath / absolutePath consistency", () => {
  it("keeps relativePath and absolutePath consistent for a nested file", async () => {
    const root = await makeWorkspace();
    const paths = await WorkspacePaths.create(root);

    const safe = await paths.safeWorkspacePath("docs/assets/logo.png");
    expect(safe.absolutePath).toBe(join(root, safe.relativePath));
  });
});
