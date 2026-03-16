import type { Command } from "commander";
import { pipelineRunCommand } from "../../commands/pipeline.js";
import { defaultRuntime } from "../../runtime.js";
import { theme } from "../../terminal/theme.js";
import { runCommandWithRuntime } from "../cli-utils.js";

export function registerPipelineCommands(program: Command) {
  const pipeline = program
    .command("pipeline")
    .description("Run pipelines with isolated execution sessions")
    .addHelpText(
      "after",
      () => `\n${theme.muted("Docs:")} https://docs.openclaw.ai/cli/pipeline\n`,
    );

  pipeline
    .command("run")
    .description("Run a pipeline agent turn")
    .requiredOption("-m, --message <text>", "Message body for the pipeline")
    .requiredOption("--agent <id>", "Agent id to run")
    .option(
      "--execution-id <id>",
      "Execution ID for session isolation (fallback: PIPELINE_EXECUTION_ID env var)",
    )
    .option("--json", "Output result as JSON", false)
    .option("--timeout <seconds>", "Override timeout (seconds, default 600 or config value)")
    .addHelpText(
      "after",
      () =>
        `
${theme.heading("Examples:")}
${theme.muted("Basic:")}
  openclaw pipeline run --agent klm-pipeline -m "hello"

${theme.muted("With execution ID (isolated session):")}
  openclaw pipeline run --agent klm-pipeline --execution-id test-123 -m "hello"

${theme.muted("Via environment variable:")}
  PIPELINE_EXECUTION_ID=exec-456 openclaw pipeline run --agent klm-pipeline -m "hello"

${theme.muted("JSON output:")}
  openclaw pipeline run --agent klm-pipeline -m "hello" --json
`,
    )
    .action(async (opts) => {
      await runCommandWithRuntime(defaultRuntime, async () => {
        await pipelineRunCommand(
          {
            agent: opts.agent as string,
            message: opts.message as string,
            executionId: opts.executionId as string | undefined,
            json: Boolean(opts.json),
            timeout: opts.timeout as string | undefined,
          },
          defaultRuntime,
        );
      });
    });

  pipeline.action(() => {
    pipeline.help();
  });
}
