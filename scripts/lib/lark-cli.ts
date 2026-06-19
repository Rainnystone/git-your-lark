import { spawn } from "node:child_process";

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

    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
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
