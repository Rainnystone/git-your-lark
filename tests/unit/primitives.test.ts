import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readJson, readUtf8, writeJson, writeUtf8 } from "../../scripts/lib/fs-utils.js";
import { sha256Buffer, sha256Text } from "../../scripts/lib/hash.js";
import { emptyState } from "../../scripts/lib/state.js";

describe("hash primitives", () => {
  it("hashes text with SHA-256", () => {
    expect(sha256Text("hello")).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  it("hashes buffers with SHA-256", () => {
    expect(sha256Buffer(Buffer.from("hello"))).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });
});

describe("fs primitives", () => {
  it("creates parent directories and roundtrips JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "gyl-fs-"));
    const path = join(root, "nested", "state.json");
    const value = { version: 1, documents: { "docs/a.md": { token: "doc" } } };

    await writeJson(path, value);

    await expect(readJson<typeof value>(path)).resolves.toEqual(value);
  });

  it("does not leave writeJson temp files after a successful write", async () => {
    const root = await mkdtemp(join(tmpdir(), "gyl-fs-temp-"));
    const path = join(root, "nested", "state.json");

    await writeJson(path, { version: 1 });

    await expect(readdir(join(root, "nested"))).resolves.toEqual(["state.json"]);
  });

  it("creates parent directories and roundtrips UTF-8 text", async () => {
    const root = await mkdtemp(join(tmpdir(), "gyl-fs-"));
    const path = join(root, "nested", "note.md");

    await writeUtf8(path, "hello\n");

    await expect(readUtf8(path)).resolves.toBe("hello\n");
  });
});

describe("state primitives", () => {
  it("creates empty state without auth token fields", () => {
    const state = emptyState("fld", "url");

    expect(state).toEqual({
      version: 1,
      remoteFolderToken: "fld",
      remoteFolderUrl: "url",
      documents: {},
      attachments: {}
    });
    expect(state).not.toHaveProperty("accessToken");
    expect(state).not.toHaveProperty("refreshToken");
    expect(state).not.toHaveProperty("tenantAccessToken");
  });
});
