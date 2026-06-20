import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanLocalWorkspace } from "../../scripts/lib/local-scan.js";

describe("scanLocalWorkspace", () => {
  it("scans markdown files, references, and attachments", async () => {
    const manifest = await scanLocalWorkspace({
      workspaceRoot: "tests/fixtures/basic-workspace",
      include: ["**/*.md"],
      exclude: []
    });

    expect(manifest.documents.map((doc) => doc.path).sort()).toEqual(["000_index.md", "001_doc.md"]);
    const indexDocument = manifest.documents.find((doc) => doc.path === "000_index.md");
    expect(indexDocument).toMatchObject({
      path: "000_index.md",
      stem: "000_index",
      title: "000_index"
    });
    expect(indexDocument?.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(indexDocument?.references).toHaveLength(1);
    expect(indexDocument?.attachments.map((att) => att.path)).toEqual(["assets/diagram.png"]);
    expect(manifest.attachments.map((att) => att.path)).toEqual(["assets/diagram.png"]);
  });

  it("applies exclude patterns", async () => {
    const manifest = await scanLocalWorkspace({
      workspaceRoot: "tests/fixtures/basic-workspace",
      include: ["**/*.md"],
      exclude: ["001_doc.md"]
    });

    expect(manifest.documents.map((doc) => doc.path)).toEqual(["000_index.md"]);
  });

  it("derives titles from normalized document paths when titleMode is path", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-local-scan-title-mode-"));
    await mkdir(join(workspaceRoot, "docs", "deep"), { recursive: true });
    await writeFile(join(workspaceRoot, "docs", "deep", "note.md"), "Nested note.\n", "utf8");

    const manifest = await scanLocalWorkspace({
      workspaceRoot,
      include: ["**/*.md"],
      exclude: [],
      titleMode: "path"
    });

    expect(manifest.documents).toHaveLength(1);
    expect(manifest.documents[0]).toMatchObject({
      path: "docs/deep/note.md",
      stem: "note",
      title: "docs - deep - note"
    });
  });

  it("includes missing referenced attachments with missing hash", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-local-scan-"));
    await mkdir(join(workspaceRoot, "docs"), { recursive: true });
    await writeFile(join(workspaceRoot, "docs", "note.md"), "![Missing](../assets/missing.png)\n", "utf8");

    const manifest = await scanLocalWorkspace({
      workspaceRoot,
      include: ["**/*.md"],
      exclude: []
    });

    expect(manifest.documents[0]?.attachments).toEqual([
      {
        path: "assets/missing.png",
        hash: "missing",
        owner: "docs/note.md"
      }
    ]);
    expect(manifest.attachments).toEqual([
      {
        path: "assets/missing.png",
        hash: "missing",
        owner: "docs/note.md"
      }
    ]);
  });

  it("marks outside-workspace attachment paths missing without hashing external files", async () => {
    const parentDir = await mkdtemp(join(tmpdir(), "gyl-local-scan-parent-"));
    const workspaceRoot = join(parentDir, "workspace");
    await mkdir(workspaceRoot, { recursive: true });
    await writeFile(join(parentDir, "outside.txt"), "real external content\n", "utf8");
    await writeFile(join(workspaceRoot, "note.md"), "![Outside](../outside.txt)\n", "utf8");

    const manifest = await scanLocalWorkspace({
      workspaceRoot,
      include: ["**/*.md"],
      exclude: []
    });

    expect(manifest.documents[0]?.attachments).toEqual([
      {
        path: "../outside.txt",
        hash: "missing",
        owner: "note.md"
      }
    ]);
    expect(manifest.attachments).toEqual([
      {
        path: "../outside.txt",
        hash: "missing",
        owner: "note.md"
      }
    ]);
  });

  it("dedupes attachments by normalized path and keeps the first owner", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-local-scan-"));
    await mkdir(join(workspaceRoot, "assets"), { recursive: true });
    await writeFile(join(workspaceRoot, "a.md"), "![Shared](assets/shared.png)\n", "utf8");
    await writeFile(join(workspaceRoot, "b.md"), "![Shared](assets/shared.png)\n", "utf8");
    await writeFile(join(workspaceRoot, "assets", "shared.png"), "shared", "utf8");

    const manifest = await scanLocalWorkspace({
      workspaceRoot,
      include: ["**/*.md"],
      exclude: []
    });

    expect(manifest.attachments).toHaveLength(1);
    expect(manifest.attachments[0]).toMatchObject({
      path: "assets/shared.png",
      owner: "a.md"
    });
  });

  it("hashes referenced image attachments that use markdown title syntax", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "gyl-local-scan-"));
    await mkdir(join(workspaceRoot, "assets"), { recursive: true });
    await writeFile(join(workspaceRoot, "note.md"), `![Image](assets/foo.png "Title")\n`, "utf8");
    await writeFile(join(workspaceRoot, "assets", "foo.png"), "image", "utf8");

    const manifest = await scanLocalWorkspace({
      workspaceRoot,
      include: ["**/*.md"],
      exclude: []
    });

    expect(manifest.attachments).toHaveLength(1);
    expect(manifest.attachments[0]).toMatchObject({
      path: "assets/foo.png",
      owner: "note.md"
    });
    expect(manifest.attachments[0]?.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.attachments[0]?.hash).not.toBe("missing");
  });
});
