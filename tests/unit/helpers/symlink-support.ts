import { symlinkSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Lazily-probed, cached answer to "can the current process create a directory
 * symlink in the OS temp dir?".
 *
 * Creating directory symlinks on Windows requires the user to be an
 * Administrator OR have Developer Mode enabled; otherwise `symlink()` throws
 * `EPERM`. Several pull tests assert that path-containment guards reject
 * symlinked directories that resolve outside the workspace. On a stock Windows
 * machine (including some CI configs) those tests cannot construct the fixture,
 * so callers skip them via `it.skipIf(!canCreateSymlink)`.
 *
 * On macOS/Linux this always resolves to `true`, so those tests run unchanged.
 * The probe runs at most once and is then cached.
 */
let cached: boolean | undefined;

export function canCreateSymlink(): boolean {
  if (cached !== undefined) {
    return cached;
  }
  const target = mkdtempSync(join(tmpdir(), "gyl-symlink-probe-"));
  const link = join(target, "link");
  let result = false;
  try {
    symlinkSync(target, link, "dir");
    result = existsSync(link);
  } catch {
    result = false;
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
  cached = result;
  return cached;
}
