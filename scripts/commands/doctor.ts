import { runCommand } from "../lib/lark-cli.js";

export const REQUIRED_LARK_COMMANDS = [
  "drive files list",
  "drive +create-folder",
  "drive +import",
  "docs +fetch",
  "docs +update",
  "docs +media-insert",
  "drive +inspect",
  "wiki +node-get",
  "wiki +node-list",
  "docs +media-download"
] as const;

export interface DoctorInput {
  larkCliPath: string;
  versionOutput: string;
  authOutput: string;
  requiredCommands: Partial<Record<string, boolean>>;
}

export interface DoctorResult {
  ok: boolean;
  problems: string[];
  warnings: string[];
}

export function analyzeDoctor(input: DoctorInput): DoctorResult {
  const problems: string[] = [];
  const warnings: string[] = [];

  if (!input.larkCliPath.trim()) {
    problems.push("lark-cli is not installed or not available on PATH.");
  }

  if (!/lark-cli version \d+\.\d+\.\d+/.test(input.versionOutput)) {
    problems.push("lark-cli --version did not return a recognizable version.");
  }

  if (!/OK|authorized|授权成功|已授权/i.test(input.authOutput)) {
    warnings.push("lark-cli auth status did not clearly show an authorized user; run lark-cli auth login if publishing fails.");
  }

  for (const command of REQUIRED_LARK_COMMANDS) {
    if (!input.requiredCommands[command]) {
      problems.push(`Required lark-cli command is unavailable: ${command}`);
    }
  }

  return { ok: problems.length === 0, problems, warnings };
}

export async function doctorCommand(): Promise<number> {
  const which = await runCommand("sh", ["-lc", "command -v lark-cli"]);
  const version = await runCommand("lark-cli", ["--version"]);
  const auth = await runCommand("lark-cli", ["auth", "status"]);

  const requiredCommands: Record<string, boolean> = {};
  for (const command of REQUIRED_LARK_COMMANDS) {
    const help = await runCommand("sh", ["-lc", `lark-cli ${command} --help >/dev/null 2>&1`]);
    requiredCommands[command] = help.code === 0;
  }

  const result = analyzeDoctor({
    larkCliPath: which.stdout.trim(),
    versionOutput: `${version.stdout}${version.stderr}`,
    authOutput: `${auth.stdout}${auth.stderr}`,
    requiredCommands
  });

  console.log(JSON.stringify(result, null, 2));
  return result.ok ? 0 : 1;
}
