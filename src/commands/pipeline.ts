import type { RuntimeEnv } from "../runtime.js";
import { agentViaGatewayCommand, type AgentCliOpts } from "./agent-via-gateway.js";

export type PipelineCliOpts = {
  agent?: string;
  message: string;
  executionId?: string;
  json?: boolean;
  timeout?: string;
};

const PIPELINE_EXECUTION_ID_ENV = "PIPELINE_EXECUTION_ID";

/**
 * Pipeline CLI command handler.
 * Wraps the existing agentViaGatewayCommand with pipeline-specific options.
 *
 * Options:
 * - --agent <id>: Agent ID (required)
 * - -m, --message <text>: Message to send (required)
 * - --execution-id <id>: Execution ID for session isolation (falls back to PIPELINE_EXECUTION_ID env var)
 * - --json: Output as JSON
 * - --timeout <seconds>: Timeout override
 */
export async function pipelineRunCommand(opts: PipelineCliOpts, runtime: RuntimeEnv) {
  // Get execution ID from CLI option or environment variable
  const executionId = opts.executionId ?? process.env[PIPELINE_EXECUTION_ID_ENV];

  // Map pipeline options to agent options
  const agentOpts: AgentCliOpts = {
    agent: opts.agent,
    message: opts.message,
    sessionKey: executionId,
    json: opts.json,
    timeout: opts.timeout,
  };

  // Use the existing agentViaGatewayCommand
  return agentViaGatewayCommand(agentOpts, runtime);
}
