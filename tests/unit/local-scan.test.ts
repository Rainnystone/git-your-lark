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
    expect(manifest.documents.find((doc) => doc.path === "000_index.md")?.references).toHaveLength(1);
    expect(manifest.attachments.map((att) => att.path)).toEqual(["assets/diagram.png"]);
  });
});
