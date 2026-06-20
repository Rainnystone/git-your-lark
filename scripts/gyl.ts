#!/usr/bin/env node
import { Command } from "commander";
import { applyCommand } from "./commands/apply.js";
import { doctorCommand } from "./commands/doctor.js";
import { initCommand } from "./commands/init.js";
import { proposalCommand } from "./commands/proposal.js";
import { scanCommand } from "./commands/scan.js";
import { verifyCommand } from "./commands/verify.js";

const program = new Command();

program
  .name("gyl")
  .description("Preview-first Markdown workspace publishing to Lark/Feishu.")
  .version("0.2.0");

program
  .command("doctor")
  .description("Check lark-cli dependency, auth, and required command availability.")
  .action(async () => {
    process.exitCode = await doctorCommand();
  });

program
  .command("init")
  .description("Create a git-your-lark.yml config file.")
  .option("--remote-folder-token <token>", "Existing target Lark Drive folder token")
  .option("--remote-folder-url <url>", "Existing target Lark Drive folder URL, stored for display only")
  .option("--create-remote-folder", "Create a new target Lark Drive folder for first publish", false)
  .option("--folder-name <name>", "Folder name to create when --create-remote-folder is set")
  .option("--parent-folder-token <token>", "Optional parent folder token for the new remote folder")
  .option("-o, --output <path>", "Config output path", "git-your-lark.yml")
  .option("-w, --workspace-root <path>", "Local workspace root", ".")
  .option("--force", "Overwrite an existing config file", false)
  .action(async (options) => {
    process.exitCode = await initCommand({
      remoteFolderToken: options.remoteFolderToken,
      remoteFolderUrl: options.remoteFolderUrl,
      createRemoteFolder: options.createRemoteFolder,
      folderName: options.folderName,
      parentFolderToken: options.parentFolderToken,
      outputPath: options.output,
      workspaceRoot: options.workspaceRoot,
      force: options.force
    });
  });

program
  .command("scan")
  .requiredOption("-c, --config <path>", "Path to git-your-lark.yml")
  .description("Scan local and remote workspace state.")
  .action(async (options) => {
    process.exitCode = await scanCommand(options.config);
  });

program
  .command("proposal")
  .requiredOption("-c, --config <path>", "Path to git-your-lark.yml")
  .description("Generate a reviewable sync proposal.")
  .action(async (options) => {
    process.exitCode = await proposalCommand(options.config);
  });

program
  .command("publish <proposal>")
  .requiredOption("-c, --config <path>", "Path to git-your-lark.yml")
  .description("Publish a reviewed sync proposal to Lark.")
  .action(async (proposal, options) => {
    process.exitCode = await applyCommand(proposal, options.config);
  });

program
  .command("apply <proposal>")
  .requiredOption("-c, --config <path>", "Path to git-your-lark.yml")
  .description("Advanced alias for publishing a reviewed sync proposal.")
  .action(async (proposal, options) => {
    process.exitCode = await applyCommand(proposal, options.config);
  });

program
  .command("merge <proposal>")
  .requiredOption("-c, --config <path>", "Path to git-your-lark.yml")
  .description("Advanced alias for publishing a reviewed sync proposal.")
  .action(async (proposal, options) => {
    process.exitCode = await applyCommand(proposal, options.config);
  });

program
  .command("verify")
  .requiredOption("-c, --config <path>", "Path to git-your-lark.yml")
  .description("Verify local Markdown titles against remote Lark docx state.")
  .action(async (options) => {
    process.exitCode = await verifyCommand(options.config);
  });

await program.parseAsync(process.argv);
