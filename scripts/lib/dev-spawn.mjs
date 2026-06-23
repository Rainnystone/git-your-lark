// Shared helpers for the developer-facing build/validate scripts
// (scripts/bundle.mjs, scripts/check-package.mjs, scripts/validate-plugin.mjs).
//
// These scripts shell out to `npm` / `python`, which on Windows are
// `.cmd`/`.bat`/`.exe` shims. Node refuses to spawn those without a shell
// (EINVAL, CVE-2024-27980), while `shell: true` + `args[]` is deprecated
// (DEP0190). We use `cross-spawn` (already a runtime dependency) which resolves
// the launcher and quotes each argument safely on every platform — no EINVAL,
// no DEP0190, no shell-injection surface. macOS/Linux behavior is unchanged.
//
// `cross-spawn`'s default export is the async `spawn`; its synchronous form is
// exposed as `spawn.sync`. We expose both under conventional names.

import _spawn from "cross-spawn";

export const spawn = _spawn;
export const spawnSync = _spawn.sync;

/**
 * Resolve an available Python 3 interpreter across platforms and return the
 * first one that runs.
 *
 * macOS/Linux ship `python3`; Windows conventionally exposes `python` or the
 * `py` launcher (rarely `python3`). We probe in that order (running
 * `--version`) and return the first one that executes successfully. Returns
 * `null` if none is available, so callers can emit a clear "install Python"
 * message instead of a raw `ENOENT`.
 */
export function resolvePython() {
  const isWin = process.platform === "win32";
  const candidates = isWin ? ["python", "py", "python3"] : ["python3", "python"];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (probe.error) {
      continue;
    }
    return candidate;
  }
  return null;
}
