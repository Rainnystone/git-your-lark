// @ts-expect-error diff is an existing runtime dependency without bundled types in this project.
import { diffLines } from "diff";

export type WritePlan =
  | { kind: "no-change" }
  | { kind: "str-replace"; pattern: string; replacement: string }
  | { kind: "requires-overwrite"; reason: string };

export function planMarkdownWrite(remoteMarkdown: string, nextMarkdown: string): WritePlan {
  if (remoteMarkdown === nextMarkdown) {
    return { kind: "no-change" };
  }

  const regions = changedRegions(remoteMarkdown, nextMarkdown);
  if (regions.length !== 1) {
    return { kind: "requires-overwrite", reason: "diff has multiple changed regions" };
  }

  const region = regions[0];
  if (!region.pattern) {
    return { kind: "requires-overwrite", reason: "diff has no non-empty removed pattern" };
  }

  if (remoteMarkdown.indexOf(region.pattern) !== remoteMarkdown.lastIndexOf(region.pattern)) {
    return { kind: "requires-overwrite", reason: "removed pattern is not unique in remote markdown" };
  }

  return {
    kind: "str-replace",
    pattern: region.pattern,
    replacement: region.replacement
  };
}

interface ChangedRegion {
  pattern: string;
  replacement: string;
}

function changedRegions(remoteMarkdown: string, nextMarkdown: string): ChangedRegion[] {
  const changes = diffLines(remoteMarkdown, nextMarkdown);
  const regions: ChangedRegion[] = [];
  let current: ChangedRegion | undefined;

  for (const change of changes) {
    if (change.added || change.removed) {
      current ??= { pattern: "", replacement: "" };
      if (change.removed) {
        current.pattern += change.value;
      }
      if (change.added) {
        current.replacement += change.value;
      }
      continue;
    }

    if (current) {
      regions.push(current);
      current = undefined;
    }
  }

  if (current) {
    regions.push(current);
  }

  return regions;
}
