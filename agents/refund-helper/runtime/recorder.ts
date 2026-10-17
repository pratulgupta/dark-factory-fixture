// GENERATED RUNTIME — copied verbatim by Kogent into agents/<name>/runtime/. Do not edit: edit the spec.
// Builds the neutral Trace (§5.2) from AI SDK callbacks. Every clause is checked against this.
import { isRefusal } from './conditions.ts'
import type { HandOffReason, Trace, TraceStep } from './types.ts'

export type TraceHeader = Pick<Trace, 'adapter' | 'adapterVersion' | 'aiPackageVersion' | 'model' | 'sampling' | 'instructionSetHash' | 'runId'>
const HAND_OFF = 'hand_off'
const toJson = (v: unknown): unknown => (v === undefined ? null : JSON.parse(JSON.stringify(v)))
const errorText = (e: unknown) => (e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e))

export class TraceRecorder {
  private steps: TraceStep[] = []
  private outputs: Trace['outputs'] = []
  private totals = { inputTokens: 0, outputTokens: 0 }
  private mark = 0
  private recorded = new Set<string>()
  private handed: HandOffReason | null = null
  private handPushed = false

  private header: TraceHeader
  private offered: ReadonlySet<string>
  /** Every model id the provider reported, across steps and segments. model.reported = the one id, or the sorted ids joined with '|'. */
  private models: Set<string>
  // Plain fields, not parameter properties: the directory runs under Node's type stripping, which only erases types.
  constructor(header: TraceHeader, offered: ReadonlySet<string>) {
    this.header = header; this.offered = offered
    this.models = new Set(header.model.reported ? header.model.reported.split('|') : [])
  }

  static from(trace: Trace, offered: ReadonlySet<string>): TraceRecorder {
    const { steps, outputs, usage, status: _s, incompleteReason: _r, ...header } = trace
    const r = new TraceRecorder(header, offered)
    r.steps = [...steps]; r.outputs = [...outputs]; r.totals = { ...usage }
    return r
  }

  beginSegment(): void { this.mark = this.steps.length }
  userMessage(text: string): void { this.steps.push({ kind: 'message', role: 'user', text }) }
  // Always await the hand-off handler first, then call handOff(): a failed handler must never leave a hand-off recorded.
  /** Marks the run handed off. The hand-off step is pushed last: at the end of the step (onStepEnd), or by trace() when no model step ran. A second call is a no-op. */
  handOff(reason: HandOffReason): void { if (this.handed === null) this.handed = reason }
  private pushHandOff(): void {
    if (this.handed !== null && !this.handPushed) { this.handPushed = true; this.steps.push({ kind: 'hand-off', reason: this.handed }) }
  }
  handedOff(): HandOffReason | null { return this.handed }
  approvalRequested(approvalId: string, tool: string, input: unknown): void { this.steps.push({ kind: 'approval-requested', approvalId, tool, input: toJson(input) }) }
  approvalAnswered(approvalId: string, granted: boolean, by?: string, expired?: boolean): void {
    this.steps.push({ kind: 'approval-answered', approvalId, granted, ...(by ? { by } : {}), ...(expired ? { expired: true } : {}) })
  }
  output(o: Trace['outputs'][number]): void { this.outputs.push(o) }
  addUsage(u: { inputTokens?: number; outputTokens?: number } | undefined): void {
    this.totals.inputTokens += u?.inputTokens ?? 0
    this.totals.outputTokens += u?.outputTokens ?? 0
  }

  callbacks() {
    return {
      onStepStart: () => { this.mark = this.steps.length },
      onToolExecutionEnd: (e: any) => {
        const call = e.toolCall
        if (call.toolName === HAND_OFF) return // recorded by handOff()
        this.recorded.add(call.toolCallId)
        const out = e.toolOutput
        const step: Extract<TraceStep, { kind: 'tool-call' }> = { kind: 'tool-call', tool: call.toolName, input: toJson(call.input), ms: Math.max(0, Math.round(e.toolExecutionMs ?? 0)) }
        if (out?.type === 'tool-error') step.error = errorText(out.error)
        else { step.output = toJson(out?.output); if (isRefusal(out?.output)) step.refused = true }
        this.steps.push(step)
      },
      onStepEnd: (step: any) => {
        this.addUsage(step.usage)
        if (step.response?.modelId) {
          this.models.add(step.response.modelId)
          this.header = { ...this.header, model: { ...this.header.model, reported: [...this.models].sort().join('|') } }
        }
        const text = typeof step.text === 'string' ? step.text : ''
        if (text.trim()) this.steps.splice(this.mark, 0, { kind: 'message', role: 'assistant', text })
        for (const p of step.content ?? []) {
          if (p.type !== 'tool-error' || this.recorded.has(p.toolCallId)) continue
          this.recorded.add(p.toolCallId)
          const offered = this.offered.has(p.toolName)
          // R7: an attempt on a tool that isn't offered is 'not available'. It is never `refused` (that means a hard limit, §4.5).
          this.steps.push({ kind: 'tool-call', tool: p.toolName, input: toJson(p.input), ms: 0, error: offered ? errorText(p.error) : 'not available' })
        }
        this.pushHandOff()
      },
    }
  }

  trace(status: 'complete' | 'incomplete', reason?: Trace['incompleteReason']): Trace {
    if (status === 'complete') this.pushHandOff()
    return { ...this.header, status, ...(reason ? { incompleteReason: reason } : {}), steps: [...this.steps], outputs: [...this.outputs], usage: { ...this.totals } }
  }
}
