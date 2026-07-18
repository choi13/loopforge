/**
 * Tool contract. A ToolDefinition is what the model sees; a Tool adds the
 * local implementation the loop executes.
 */

export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool input. */
  inputSchema: Record<string, unknown>;
}

export interface ToolResult {
  output: string;
  isError?: boolean;
}

export interface Tool extends ToolDefinition {
  // Input arrives as model-produced JSON; each tool validates what it needs.
  // The optional signal lets long-running tools (e.g. a shell command) abort
  // when the run is aborted.
  execute(input: any, signal?: AbortSignal): Promise<ToolResult>;
}
