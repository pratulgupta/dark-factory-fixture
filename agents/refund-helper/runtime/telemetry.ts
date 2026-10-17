// GENERATED RUNTIME — copied verbatim by Kogent into agents/<name>/runtime/. Do not edit: edit the spec.
// OpenTelemetry spans derived from the trace (§8.6). GenAI semantic conventions are in Development; this version is pinned.
import { context, trace as otel, SpanStatusCode, type Tracer } from '@opentelemetry/api'
import type { ProofStatus } from './proof.ts'
import type { Trace } from './types.ts'

export const GENAI_SEMCONV_VERSION = '1.37.0'
export interface SegmentInfo {
  agentName: string; provider: string; fromStep: number; usageBefore: { inputTokens: number; outputTokens: number }; outputsBefore: number; startMs: number; endMs: number; captureContent: boolean
  unproven: string[]; approvals: Array<{ approvalId: string; by?: string; at: string; expired?: boolean }>
}

export function unprovenReasons(t: Trace, proof: ProofStatus, approvals: SegmentInfo['approvals']): string[] {
  const out = [...proof.reasons]
  // A run that changed model mid-way reports its ids joined with '|' (sorted): any id outside the proven one(s) is named.
  if (proof.reportedModel && t.model.reported && t.model.reported !== proof.reportedModel) {
    const proven = new Set(proof.reportedModel.split('|'))
    const odd = t.model.reported.split('|').filter((m) => !proven.has(m))
    out.push(`model ${odd.length ? odd.join(', ') : t.model.reported} is not the proven ${proof.reportedModel}`)
  }
  if (approvals.some((a) => !a.expired && !a.by)) out.push('an approval was answered with no person named')
  return out
}

export function emitSpans(tracer: Tracer, t: Trace, s: SegmentInfo): void {
  const steps = t.steps.slice(s.fromStep)
  const agent = tracer.startSpan(`invoke_agent ${s.agentName}`, { startTime: s.startMs, attributes: {
    'gen_ai.operation.name': 'invoke_agent', 'gen_ai.agent.name': s.agentName, 'gen_ai.provider.name': s.provider,
    'gen_ai.request.model': t.model.specified, 'gen_ai.response.model': t.model.reported,
    'gen_ai.usage.input_tokens': t.usage.inputTokens - s.usageBefore.inputTokens, 'gen_ai.usage.output_tokens': t.usage.outputTokens - s.usageBefore.outputTokens,
    'kogent.status': t.status, ...(t.incompleteReason ? { 'kogent.incomplete_reason': t.incompleteReason } : {}),
    'kogent.instruction_set_hash': t.instructionSetHash, 'kogent.agent_format': 1, 'kogent.adapter': t.adapter,
    'kogent.ai_version': t.aiPackageVersion, 'kogent.run_id': t.runId, 'kogent.semconv_version': GENAI_SEMCONV_VERSION,
    'kogent.unproven': s.unproven.length > 0, 'kogent.unproven_reasons': s.unproven,
  } })
  if (s.captureContent) {
    agent.setAttribute('gen_ai.input.messages', JSON.stringify(steps.filter((x) => x.kind === 'message' && x.role === 'user')))
    agent.setAttribute('gen_ai.output.messages', JSON.stringify(t.outputs.slice(s.outputsBefore)))
  }
  if (t.status === 'incomplete') agent.setStatus({ code: SpanStatusCode.ERROR })
  for (const step of steps) {
    if (step.kind !== 'approval-requested') continue
    agent.addEvent('kogent.approval.requested', { 'kogent.approval.id': step.approvalId, 'kogent.approval.tool': step.tool, ...(s.captureContent ? { 'kogent.approval.input': JSON.stringify(step.input) } : {}) })
  }
  for (const a of s.approvals) {
    agent.addEvent('kogent.approval', { 'kogent.approval.id': a.approvalId, 'kogent.approval.granted': !a.expired && t.steps.some((x) => x.kind === 'approval-answered' && x.approvalId === a.approvalId && x.granted), 'kogent.approval.by': a.by ?? '', 'kogent.approval.at': a.at })
  }
  const ctx = otel.setSpan(context.active(), agent)
  for (const step of steps) {
    if (step.kind !== 'tool-call') continue
    const span = tracer.startSpan(`execute_tool ${step.tool}`, { startTime: s.startMs, attributes: {
      'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': step.tool, 'kogent.tool.refused': step.refused === true,
      ...(s.captureContent ? { 'gen_ai.tool.call.arguments': JSON.stringify(step.input), 'gen_ai.tool.call.result': JSON.stringify(step.output ?? null) } : {}),
    } }, ctx)
    if (step.error) {
      // The error text can carry customer data: it is content, gated like the arguments.
      if (s.captureContent) span.setStatus({ code: SpanStatusCode.ERROR, message: step.error })
      else { span.setAttribute('error.type', 'tool_error'); span.setStatus({ code: SpanStatusCode.ERROR }) }
    }
    span.end(s.startMs + step.ms)
  }
  agent.end(s.endMs)
}
