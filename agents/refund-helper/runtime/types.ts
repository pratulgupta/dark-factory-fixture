// GENERATED RUNTIME — copied verbatim by Kogent into agents/<name>/runtime/. Do not edit: edit the spec.
import type { LanguageModel, ModelMessage } from 'ai'
import type { Tracer } from '@opentelemetry/api'
import type { Condition } from './conditions.ts'

export type HandOffReason = 'instruction' | 'approval-expired' | 'off'

export interface ToolConfig {
  id: string; name: string; description: string
  inputSchema: Record<string, unknown>; outputSchema: Record<string, unknown>
  effect: 'reads' | 'changes' | 'reaches-outside'
  permission: 'allowed' | 'asks-first' | 'never'
  approvalCondition?: Condition
  approvalTimeout?: { afterMinutes: number; then: 'refuse' | 'hand-off' }
  hardLimits: Condition[]
  /** Set when this tool reads a source: it searches deps.stores[name], never a backend. */
  source?: { id: string; name: string; documentsDir: string }
}

export interface AgentConfig {
  agentFormat: 1; name: string
  adapter: 'ts/ai-sdk'; adapterVersion: string; aiVersion: string
  model: { provider: 'anthropic' | 'openai'; id: string }
  sampling: { temperature?: number; topP?: number }
  maxSteps: number
  instructionSetHash: string
  tools: ToolConfig[]
  /** `templatePath` names the compiled template (templates/<shape-id>.md) when the shape has one (P4-R45). */
  outputShape?: { id: string; name: string; schema: Record<string, unknown>; templatePath?: string }
  proofPublicKeyPem: string
}

export interface DocumentStore {
  search(query: string): Promise<Array<{ id: string; text: string }>>
  get(id: string): Promise<{ id: string; text: string } | null>
}
export type Backend = (input: any) => Promise<unknown>
export interface ToolCtx { runId: string; backend?: Backend; store?: DocumentStore }
export type ToolFn = (input: any, ctx: ToolCtx) => Promise<unknown>
/** `templateMd` is the output shape's compiled template file, header included, when it has one (P4-R45). */
export interface AgentDefinition { config: AgentConfig; instructionsMd: string; templateMd?: string; tools: Record<string, ToolFn>; dir?: string }

export interface ApprovalRequest {
  runId: string; approvalId: string; tool: string; input: unknown; reason: string
  /** The person's last message, clipped to 280 characters: context for the approver, not the conversation (it may be sent to Slack or email). */
  conversationSummary: string
  deadline: string | null
}
export interface ApprovalAnswer { approved: boolean; by?: string; at: string }
export interface PendingApproval { approvalId: string; toolCallId: string; tool: string; input: unknown; deadline: string | null; then: 'refuse' | 'hand-off' | null }
export interface PausedRun {
  runId: string; messages: ModelMessage[]; pending: PendingApproval[]
  answers: Record<string, ApprovalAnswer & { expired?: boolean }>
  trace: Trace
}
export interface PendingApprovalStore {
  save(run: PausedRun): Promise<void>
  load(runId: string): Promise<PausedRun | null>
  delete(runId: string): Promise<void>
  list(): Promise<PausedRun[]>
  /**
   * Atomically merges one answer into the stored run and returns the updated run, or null if the run is gone.
   * Throws `approval <id> is already answered` if that approval already has an answer.
   * A durable store MUST implement this atomically (a transaction or compare-and-swap): two people answering
   * different approvals of one step must both be kept.
   */
  recordAnswer(runId: string, approvalId: string, answer: ApprovalAnswer & { expired?: boolean }): Promise<PausedRun | null>
  /**
   * Atomically removes the run and returns it, so only ONE caller ever gets it; everyone else gets null.
   * A durable store MUST implement this atomically (a transaction or compare-and-swap, e.g. DELETE ... RETURNING).
   */
  claim(runId: string): Promise<PausedRun | null>
}

export interface BaseDeps {
  provider: (modelId: string) => LanguageModel
  backends: Record<string, Backend>
  stores: Record<string, DocumentStore>
  onHandOff: (e: { runId: string; conversation: ModelMessage[]; reason: HandOffReason }) => Promise<void>
  onApprovalRequest?: (e: ApprovalRequest) => Promise<void>
  pendingApprovals?: PendingApprovalStore
  approvalSecret?: string
  telemetry?: { tracer?: Tracer; captureContent?: boolean }
  /** The off switch (§8.5): read at the start of every run and before every resume. */
  isOff: () => Promise<boolean>
}

export interface RunRequest { runId: string; now: string; message: string; priorTurns?: Array<{ role: 'user' | 'assistant'; text: string }>; history?: ModelMessage[]; abortSignal?: AbortSignal }
export type RunResult =
  | { status: 'done'; runId: string; text: string; output?: unknown; messages: ModelMessage[]; trace: Trace }
  | { status: 'paused'; runId: string; pending: string[]; trace: Trace }
  | { status: 'waiting'; runId: string; pending: string[] }
  | { status: 'handed-off'; runId: string; reason: HandOffReason; trace: Trace }

// Structural copy of @kogent/agent-kit's Trace (§5.2); the conformance suite parses every trace with agent-kit's traceSchema.
export type TraceStep =
  | { kind: 'message'; role: 'user' | 'assistant'; text: string }
  | { kind: 'tool-call'; tool: string; input: unknown; output?: unknown; error?: string; refused?: boolean; ms: number }
  | { kind: 'approval-requested'; approvalId: string; tool: string; input: unknown }
  | { kind: 'approval-answered'; approvalId: string; granted: boolean; by?: string; expired?: boolean }
  | { kind: 'hand-off'; reason: HandOffReason }
export interface Trace {
  adapter: string; adapterVersion: string; aiPackageVersion: string
  model: { specified: string; reported: string }
  sampling: { temperature?: number; topP?: number }
  instructionSetHash: string; runId: string
  status: 'complete' | 'incomplete'
  incompleteReason?: 'timeout' | 'ceiling' | 'provider' | 'infra'
  steps: TraceStep[]
  outputs: Array<{ shape?: string; text: string; value?: unknown }>
  usage: { inputTokens: number; outputTokens: number }
}

/** The case's test world (structural copy of agent-kit's TestWorld). */
export interface TestWorld {
  rows: Array<{ id: string; entity: string; fields: Record<string, string> }>
  documents: Array<{ path: string; text: string }>
}
