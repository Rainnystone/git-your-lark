import spawn from "cross-spawn";

/**
 * Spawn an external command cross-platform.
 *
 * `lark-cli`, `npm`, `python`, … resolve to `.cmd`/`.bat`/`.exe` shims on
 * Windows. Node 18.20+/20.12+ (CVE-2024-27980) refuses to spawn `.cmd`/`.bat`
 * without a shell, yet `shell: true` + a raw `args[]` is deprecated (DEP0190)
 * because cmd.exe re-parses arguments — and several `lark-cli` calls pass
 * user-controlled text (document titles that may contain `&`, `|`, `>`, `"`,
 * …), so shell parsing would be an injection/correctness hazard.
 *
 * `cross-spawn` resolves both problems: it locates the launcher (`.cmd`/`.exe`)
 * and quotes each argument safely, so arguments are passed verbatim on every
 * platform with no shell-injection surface. This is the de-facto cross-platform
 * spawn (used by webpack, eslint, electron, npm internals). On macOS/Linux it
 * behaves identically to `node:child_process` `spawn`.
 */
export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runCommand(command: string, args: string[], cwd = process.cwd()): Promise<CommandResult> {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = "";
    let stderr = "";

    const finish = (result: CommandResult): void => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });

    // cross-spawn's ChildProcess types mark stdio streams as `| null` (unlike
    // node's own types); with the stdio config above they are always present.
    const out = child.stdout;
    const err = child.stderr;
    if (out) {
      out.on("data", (chunk) => {
        stdout += String(chunk);
      });
    }
    if (err) {
      err.on("data", (chunk) => {
        stderr += String(chunk);
      });
    }
    child.on("error", (error) => {
      finish({ code: 1, stdout, stderr: stderr + error.message });
    });
    child.on("close", (code) => {
      finish({ code: code ?? 1, stdout, stderr });
    });
  });
}

export function extractJson(output: string): unknown {
  for (let start = output.indexOf("{"); start >= 0; start = output.indexOf("{", start + 1)) {
    const objectSource = extractJsonObjectSource(output, start);
    if (!objectSource) continue;

    try {
      return JSON.parse(objectSource);
    } catch {
      continue;
    }
  }

  throw new Error(`No JSON object found in command output: ${output.slice(0, 200)}`);
}

function extractJsonObjectSource(output: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < output.length; index += 1) {
    const char = output[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return output.slice(start, index + 1);
      }
    }
  }

  return null;
}
