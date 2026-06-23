import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export async function readUtf8(path: string): Promise<string> {
  return readFile(path, "utf8");
}

/**
 * Normalize all line endings to LF (`\n`).
 *
 * Authoring tools and git checkouts on Windows can produce CRLF (`\r\n`) or
 * lone CR (`\r`) files. Several Markdown parsers in this repo split on `\n`
 * only, and frontmatter detection keys on `"---\n"`, so a stray `\r` would
 * either leak into fence detection or cause frontmatter to be reported as
 * missing. Normalizing at the parse entry points keeps those parsers on LF.
 *
 * For LF input (the default on macOS/Linux, and what every writer here emits)
 * this is a no-op: `\r\n`/`\r` simply do not occur.
 */
export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * Split Markdown into lines (each retaining its trailing `\n`), normalizing
 * CRLF/CR to LF first. Mirrors the historical `markdown.match(/[^\n]*(?:\n|$)/g)`
 * splitter used by the fence/link scanners, but shared and line-ending-safe.
 *
 * The trailing empty element produced by the regex (when `markdown` ends with
 * `\n`) is dropped, matching the prior per-module `splitLines` helpers.
 */
export function splitMarkdownLines(markdown: string): string[] {
  const lines = normalizeLineEndings(markdown).match(/[^\n]*(?:\n|$)/g) ?? [];
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

export async function readJson<T = unknown>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tempPath = join(dir, `.${basename(path)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`);
  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function writeUtf8(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, "utf8");
}
