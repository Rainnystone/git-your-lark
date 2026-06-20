import type { LocalManifest } from "./local-scan.js";
import type { RemoteManifest } from "./remote-scan.js";

export interface VerifyResult {
  ok: boolean;
  problems: string[];
}

export function verifyManifest(local: LocalManifest, remote: RemoteManifest): VerifyResult {
  const problems: string[] = [];
  const remoteDocxTitles = new Set(
    remote.entries.filter((entry) => entry.type === "docx").map((entry) => entry.name)
  );

  for (const document of local.documents) {
    if (!remoteDocxTitles.has(document.title)) {
      problems.push(`Local document is missing a remote docx with the same title: ${document.title}`);
    }
  }

  for (const entry of remote.entries) {
    if (entry.type !== "docx" && entry.name.toLowerCase().endsWith(".md")) {
      problems.push(`Remote plain Markdown file should not exist after publish: ${entry.name}`);
    }
  }

  return {
    ok: problems.length === 0,
    problems
  };
}
