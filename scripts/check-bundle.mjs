#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { spawnSync } from "./lib/dev-spawn.mjs";

const bundleFiles = ["bin/gyl", "bin/gyl.cmd"];

if (isMainModule()) {
  main();
}

export function main(argv = process.argv.slice(2)) {
  if (argv.includes("--git-diff")) {
    checkGitDiff();
  } else {
    checkRegeneratedBundle();
  }
}

export function nodeModulesLinkType(platform = process.platform) {
  return platform === "win32" ? "junction" : "dir";
}

function isMainModule() {
  return process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
}

export function checkGitDiff() {
  const result = spawnSync("git", ["diff", "--exit-code", "--", ...bundleFiles], {
    encoding: "utf8"
  });

  if (result.error) {
    console.error(`Failed to inspect bundled CLI artifacts: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    printOutOfDateMessage();
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }

  console.log("Bundled CLI artifacts are up to date.");
}

export function checkRegeneratedBundle() {
  const repoRoot = getRepoRoot();
  const tempRoot = join(tmpdir(), `gyl-bundle-check-${process.pid}-${Date.now()}`);
  try {
    copyWorkingTree(repoRoot, tempRoot);
    linkNodeModules(repoRoot, tempRoot);

    const build = spawnSync(process.execPath, ["scripts/bundle.mjs"], {
      cwd: tempRoot,
      encoding: "utf8"
    });
    if (build.error) {
      console.error(`Failed to regenerate bundled CLI artifacts: ${build.error.message}`);
      process.exit(1);
    }
    if (build.status !== 0) {
      if (build.stdout) process.stderr.write(build.stdout);
      if (build.stderr) process.stderr.write(build.stderr);
      process.exit(build.status ?? 1);
    }

    const mismatched = bundleFiles.filter((file) => !sameFile(join(repoRoot, file), join(tempRoot, file)));
    if (mismatched.length > 0) {
      printOutOfDateMessage();
      console.error(`Mismatched files: ${mismatched.join(", ")}`);
      process.exit(1);
    }

    console.log("Bundled CLI artifacts are up to date.");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function getRepoRoot() {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8"
  });
  if (result.error || result.status !== 0) {
    console.error("Failed to locate git repository root.");
    process.exit(1);
  }
  return result.stdout.trim();
}

function copyWorkingTree(repoRoot, tempRoot) {
  mkdirSync(tempRoot, { recursive: true });
  for (const file of listGitFiles(repoRoot)) {
    const source = join(repoRoot, file);
    const destination = join(tempRoot, file);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, readFileSync(source));
  }
}

function listGitFiles(repoRoot) {
  const tracked = gitFileList(["ls-files", "-z"], repoRoot);
  const untracked = gitFileList(["ls-files", "--others", "--exclude-standard", "-z"], repoRoot);
  return [...new Set([...tracked, ...untracked])].filter(Boolean);
}

function gitFileList(args, repoRoot) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "buffer"
  });
  if (result.error || result.status !== 0) {
    console.error(`Failed to list git files: git ${args.join(" ")}`);
    process.exit(1);
  }
  return result.stdout.toString("utf8").split("\0").filter(Boolean);
}

function linkNodeModules(repoRoot, tempRoot) {
  const nodeModules = join(repoRoot, "node_modules");
  if (existsSync(nodeModules)) {
    symlinkSync(nodeModules, join(tempRoot, "node_modules"), nodeModulesLinkType());
  }
}

function sameFile(left, right) {
  if (!existsSync(left) || !existsSync(right)) return false;
  return readFileSync(left).equals(readFileSync(right));
}

function printOutOfDateMessage() {
  console.error(
    [
      "Bundled CLI artifacts are out of date.",
      "Run `npm run build:bundle` and commit the regenerated `bin/gyl` and `bin/gyl.cmd` files."
    ].join("\n")
  );
}
