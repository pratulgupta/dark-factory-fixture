// GENERATED RUNTIME — copied verbatim by Kogent into agents/<name>/runtime/. Do not edit: edit the spec.
// The one constructor production and the case runner share (§5.4 "One factory").
import { ToolLoopAgent, tool, jsonSchema, Output, NoObjectGeneratedError, isStepCount, hasToolCall, InvalidToolApprovalError, InvalidToolApprovalSignatureError, ToolCallNotFoundForApprovalError, type ModelMessage, type ToolSet, type OutputInterface } from 'ai'
import { holds, describeCondition } from './conditions.ts'
import { composeInstructions, templateBody } from './instructions.ts'
import { checkProof, type ProofStatus } from './proof.ts'
import { emitSpans, unprovenReasons, type SegmentInfo } from './telemetry.ts'
import { TraceRecorder, type TraceHeader } from './recorder.ts'
import type { AgentDefinition, ApprovalAnswer, BaseDeps, PausedRun, PendingApproval, RunRequest, RunResult, Trace } from './types.ts'

export const HAND_OFF_TOOL = 'hand_off'
const HAND_OFF_DESCRIPTION = 'Hand this conversation to a person. Use it only when your instructions say to hand off. You will not speak again after it.'

// Plain fields, not parameter properties: the directory runs under Node's type stripping, which only erases types.
export class AgentDepsError extends Error {
  missing: string[]
  constructor(missing: string[]) { super(`the agent cannot start: ${missing.join('; ')}`); this.name = 'AgentDepsError'; this.missing = missing }
}
export class AgentRunError extends Error {
  trace: Trace
  cause: unknown
  acted: boolean
  constructor(message: string, trace: Trace, cause: unknown, acted = false) { super(message); this.name = 'AgentRunError'; this.trace = trace; this.cause = cause; this.acted = acted }
}

/**
 * The saved run no longer matches its approval signature (edited, or `approvalSecret` was rotated), or its approval
 * does not match its tool call. It can never resume, so it is not put back: the claim already removed it.
 */
export class ApprovalVerificationError extends AgentRunError {
  runId: string
  constructor(runId: string, trace: Trace, cause: unknown) {
    super(`approval verification failed for run ${runId}: the saved run no longer matches its approval signature, so it was dropped: ${cause instanceof Error ? cause.message : String(cause)}`, trace, cause)
    this.name = 'ApprovalVerificationError'
    this.runId = runId
  }
}
const failedVerification = (e: unknown) =>
  InvalidToolApprovalSignatureError.isInstance(e) || InvalidToolApprovalError.isInstance(e) || ToolCallNotFoundForApprovalError.isInstance(e)

/** A claimed paused run could not be put back. The run itself is on the error, so the customer can re-save it. */
export class PausedRunLostError extends Error {
  runId: string
  run: PausedRun
  cause: unknown
  original?: unknown
  constructor(runId: string, run: PausedRun, cause: unknown, original?: unknown) {
    super(`paused run ${runId} could not be saved back to the pending-approval store; the error carries the run so it can be re-saved`)
    this.name = 'PausedRunLostError'
    this.runId = runId; this.run = run; this.cause = cause; this.original = original
  }
}

export function validateDeps(def: AgentDefinition, deps: BaseDeps): void {
  const { config } = def
  const missing: string[] = []
  for (const t of config.tools) {
    if (t.permission === 'never') continue
    if (t.source) { if (!deps.stores?.[t.name]) missing.push(`stores.${t.name} is missing`) }
    else if (!deps.backends?.[t.name]) missing.push(`backends.${t.name} is missing`)
  }
  const asks = config.tools.some((t) => t.permission === 'asks-first')
  if (asks && !deps.onApprovalRequest) missing.push('onApprovalRequest is missing')
  if (asks && !deps.pendingApprovals) missing.push('pendingApprovals is missing')
  if (asks && !deps.approvalSecret) missing.push('approvalSecret is missing')
  if (typeof deps.onHandOff !== 'function') missing.push('onHandOff is missing')
  if (typeof deps.isOff !== 'function') missing.push('isOff is missing')
  if (typeof deps.provider !== 'function') missing.push('provider is missing')
  else {
    const m = deps.provider(config.model.id)
    const p = typeof m === 'string' ? '' : m.provider
    if (!p.startsWith(config.model.provider)) missing.push(`provider is "${p || 'a model id string'}", the spec says ${config.model.provider}`)
  }
  if (missing.length) throw new AgentDepsError(missing)
}

export interface AgentOptions {
  withoutInstructions?: string[]
  /** Proof only (createAgentForProof): a later customer turn's remaining step budget (agent specs §4.5 rev 7). buildAgent
   *  never passes it, so it is not a dial (§8.5). */
  maxSteps?: number
}
export interface AgentHandle {
  run(req: RunRequest): Promise<RunResult>
  resume(runId: string, approvalId: string, answer: ApprovalAnswer, opts?: { abortSignal?: AbortSignal }): Promise<RunResult>
  expire(now: string, opts?: { abortSignal?: AbortSignal }): Promise<RunResult[]>
}

const stringsIn = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(stringsIn) : v && typeof v === 'object' ? Object.values(v).flatMap(stringsIn) : []

/**
 * Output.object, but a reply that doesn't parse is `undefined`, never a thrown run: uses-shape judges it.
 * generateText parses the final text eagerly and Output.object throws NoObjectGeneratedError on bad JSON, which
 * would otherwise end the run as AgentRunError (an incomplete, re-drawn run). No schema mismatch is thrown here:
 * uses-shape re-validates the value with ajv.
 */
function lenientObject(schema: Record<string, unknown>): OutputInterface<unknown> {
  const base = Output.object({ schema: jsonSchema(schema as never) })
  return {
    ...base,
    parseCompleteOutput: async (o, c) => {
      try { return await base.parseCompleteOutput(o, c) } catch (e) { if (NoObjectGeneratedError.isInstance(e)) return undefined; throw e }
    },
  }
}

/**
 * A minimal JSON Schema check: type, enum, const, required, properties, additionalProperties: false, items,
 * minimum, maximum, exclusiveMinimum, exclusiveMaximum, minLength, maxLength, pattern, minItems and maxItems.
 * codegen refuses a tool input schema using any other validation keyword, so nothing authored goes unchecked.
 * The AI SDK's jsonSchema() validates nothing unless given a validate function, and the template may import only 'ai'.
 */
export function check(schema: any, v: unknown, path: string): string | null {
  if (!schema || typeof schema !== 'object') return null
  const at = path || 'input'
  const types: string[] | undefined = schema.type === undefined ? undefined : Array.isArray(schema.type) ? schema.type : [schema.type]
  const typeOf = (x: unknown) => (x === null ? 'null' : Array.isArray(x) ? 'array' : typeof x === 'number' && Number.isInteger(x) ? 'integer' : typeof x)
  if (types && !types.some((t) => t === typeOf(v) || (t === 'number' && typeof v === 'number'))) return `${at} must be ${types.join(' or ')}`
  if (Array.isArray(schema.enum) && !schema.enum.some((e: unknown) => JSON.stringify(e) === JSON.stringify(v))) return `${at} must be one of the allowed values`
  if ('const' in schema && JSON.stringify(schema.const) !== JSON.stringify(v)) return `${at} must be ${JSON.stringify(schema.const)}`
  if (typeof v === 'number') {
    if (typeof schema.minimum === 'number' && v < schema.minimum) return `${at} must be at least ${schema.minimum}`
    if (typeof schema.maximum === 'number' && v > schema.maximum) return `${at} must be at most ${schema.maximum}`
    if (typeof schema.exclusiveMinimum === 'number' && v <= schema.exclusiveMinimum) return `${at} must be more than ${schema.exclusiveMinimum}`
    if (typeof schema.exclusiveMaximum === 'number' && v >= schema.exclusiveMaximum) return `${at} must be less than ${schema.exclusiveMaximum}`
  }
  if (typeof v === 'string') {
    const chars = [...v].length // JSON Schema counts characters, not UTF-16 units
    if (typeof schema.minLength === 'number' && chars < schema.minLength) return `${at} must be at least ${schema.minLength} characters`
    if (typeof schema.maxLength === 'number' && chars > schema.maxLength) return `${at} must be at most ${schema.maxLength} characters`
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(v)) return `${at} must match ${schema.pattern}`
  }
  if (Array.isArray(v)) {
    if (typeof schema.minItems === 'number' && v.length < schema.minItems) return `${at} must have at least ${schema.minItems} items`
    if (typeof schema.maxItems === 'number' && v.length > schema.maxItems) return `${at} must have at most ${schema.maxItems} items`
  }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>
    for (const k of schema.required ?? []) if (!Object.hasOwn(o, k)) return `${path ? path + '.' : ''}${k} is required`
    for (const [k, sub] of Object.entries(schema.properties ?? {})) if (Object.hasOwn(o, k)) { const e = check(sub, o[k], `${path ? path + '.' : ''}${k}`); if (e) return e }
    if (schema.additionalProperties === false) for (const k of Object.keys(o)) if (!Object.hasOwn(schema.properties ?? {}, k)) return `${path ? path + '.' : ''}${k} is not allowed`
  }
  if (Array.isArray(v) && schema.items) for (let i = 0; i < v.length; i++) { const e = check(schema.items, v[i], `${path}[${i}]`); if (e) return e }
  return null
}
const checked = (schema: Record<string, unknown>) =>
  jsonSchema(schema as never, { validate: (value: unknown) => { const e = check(schema, value, ''); return e ? { success: false as const, error: new Error(e) } : { success: true as const, value } } } as never)

const proofCache = new Map<string, ProofStatus>()
// Checked once per process per directory: a replaced proof.json is seen at the next start.
// Never throws: a check that cannot run means unproven, not an agent that cannot be built.
function proofOf(def: AgentDefinition): ProofStatus {
  if (!def.dir) return { proven: false, reasons: ['not a generated agent'], reportedModel: null }
  let s = proofCache.get(def.dir)
  if (!s) { try { s = checkProof({ dir: def.dir, publicKeyPem: def.config.proofPublicKeyPem }) } catch (e) { s = { proven: false, reasons: [`the startup check failed: ${e instanceof Error ? e.message : String(e)}`], reportedModel: null } }
    proofCache.set(def.dir, s) }
  return s
}

export function createAgent(def: AgentDefinition, deps: BaseDeps, opts: AgentOptions = {}): AgentHandle {
  validateDeps(def, deps)
  const { config } = def
  const instructions = composeInstructions(def.instructionsMd, {
    without: opts.withoutInstructions ?? [],
    ...(def.templateMd && config.outputShape ? { template: { name: config.outputShape.name, text: templateBody(def.templateMd) } } : {}),
  })
  const model = deps.provider(config.model.id)
  const proof = proofOf(def)

  type Before = { usage: Trace['usage']; outputs: { length: number } }
  /** Spans are derived from the trace; a failing exporter must never fail or double a run, so emit errors are swallowed. */
  function emit(t: Trace, fromStep: number, startMs: number, approvals: SegmentInfo['approvals'], before: Before | null = null): void {
    const tracer = deps.telemetry?.tracer
    if (!tracer) return
    try {
      emitSpans(tracer, t, { agentName: config.name, provider: config.model.provider, fromStep, startMs, endMs: Date.now(),
        usageBefore: before ? { ...before.usage } : { inputTokens: 0, outputTokens: 0 }, outputsBefore: before ? before.outputs.length : 0,
        captureContent: deps.telemetry?.captureContent === true, unproven: unprovenReasons(t, proof, approvals), approvals })
    } catch { /* telemetry is best effort */ }
  }
  function observed(r: RunResult, fromStep: number, startMs: number, approvals: SegmentInfo['approvals'] = [], before: Before | null = null): RunResult {
    if ('trace' in r) emit(r.trace, fromStep, startMs, approvals, before)
    return r
  }
  /** Emits the incomplete trace of a failed segment (no throw). */
  function emitFailed(e: unknown, fromStep: number, startMs: number, approvals: SegmentInfo['approvals'] = [], before: Before | null = null): void {
    if (e instanceof AgentRunError) emit(e.trace, fromStep, startMs, approvals, before)
  }
  function failed(e: unknown, fromStep: number, startMs: number, approvals: SegmentInfo['approvals'] = [], before: Before | null = null): never {
    emitFailed(e, fromStep, startMs, approvals, before)
    throw e
  }
  const offered = new Set([...config.tools.filter((t) => t.permission !== 'never').map((t) => t.name), HAND_OFF_TOOL])
  const header = (runId: string): TraceHeader => ({
    adapter: config.adapter, adapterVersion: config.adapterVersion, aiPackageVersion: config.aiVersion,
    model: { specified: config.model.id, reported: '' }, sampling: config.sampling, instructionSetHash: config.instructionSetHash, runId,
  })

  const toolApproval: Record<string, unknown> = {}
  for (const t of config.tools) {
    if (t.permission === 'never') toolApproval[t.name] = 'denied'
    if (t.permission === 'asks-first') {
      const c = t.approvalCondition
      toolApproval[t.name] = c ? (input: unknown) => (holds(c, input) ? 'user-approval' : 'not-applicable') : 'user-approval'
    }
  }

  function buildTools(runId: string, rec: TraceRecorder, conversation: () => ModelMessage[], state: { executed: boolean }): ToolSet {
    const tools: ToolSet = {}
    for (const t of config.tools) {
      if (t.permission === 'never') continue
      const fn = def.tools[t.name]
      tools[t.name] = tool({
        description: t.description,
        inputSchema: checked(t.inputSchema),
        outputSchema: jsonSchema(t.outputSchema as never),
        execute: async (input: unknown) => { state.executed = true; return fn(input, { runId, backend: deps.backends[t.name], store: t.source ? deps.stores[t.name] : undefined }) },
      })
    }
    tools[HAND_OFF_TOOL] = tool({
      description: HAND_OFF_DESCRIPTION,
      inputSchema: jsonSchema({ type: 'object', properties: {}, additionalProperties: false } as never),
      execute: async (_input: unknown, options: { messages?: ModelMessage[] }) => {
        state.executed = true
        // Marked handed off only once the handler succeeds: a failing handler must not read as a hand-off.
        await deps.onHandOff({ runId, conversation: options?.messages ?? conversation(), reason: 'instruction' })
        rec.handOff('instruction')
        return { handedOff: true }
      },
    })
    return tools
  }

  async function segment(runId: string, now: string, messages: ModelMessage[], rec: TraceRecorder, abortSignal?: AbortSignal): Promise<RunResult> {
    rec.beginSegment()
    const state = { executed: false } // set the moment any tool function is entered: a tool that ran and threw still acted
    const agent = new ToolLoopAgent({
      model, instructions,
      tools: buildTools(runId, rec, () => messages, state),
      toolApproval: toolApproval as never,
      stopWhen: [isStepCount(opts.maxSteps ?? config.maxSteps), hasToolCall(HAND_OFF_TOOL)],
      ...(config.outputShape ? { output: lenientObject(config.outputShape.schema) } : {}),
      ...(deps.approvalSecret ? { experimental_toolApprovalSecret: deps.approvalSecret } : {}),
      temperature: config.sampling.temperature, topP: config.sampling.topP,
    } as never) as ToolLoopAgent<never, ToolSet>
    let result: any
    try {
      result = await agent.generate({ messages, abortSignal, ...rec.callbacks() } as never)
    } catch (err) {
      throw new AgentRunError(err instanceof Error ? err.message : String(err), rec.trace('incomplete'), err, state.executed)
    }
    const failed = (result.steps as any[] ?? []).flatMap((st) => st.content ?? []).find((p) => p.type === 'tool-error' && p.toolName === HAND_OFF_TOOL)
    if (failed) throw new AgentRunError(`the hand-off handler failed: ${failed.error instanceof Error ? failed.error.message : String(failed.error)}`, rec.trace('incomplete'), failed.error, state.executed)
    // A hand-off is terminal (§4.1): checked first, so an approval requested in the same step is dropped, never paused on.
    if (rec.handedOff()) return { status: 'handed-off', runId, reason: 'instruction', trace: rec.trace('complete') }
    const requests = (result.content as any[]).filter((p) => p.type === 'tool-approval-request')
    if (requests.length) return pause(runId, now, [...messages, ...result.responseMessages], requests, rec, state)
    let output: unknown
    if (config.outputShape) {
      // lenientObject leaves the output undefined on an unparsable reply; the getter then throws NoOutputGeneratedError.
      try { output = result.output } catch { output = undefined }
      rec.output(output === undefined ? { shape: config.outputShape.id, text: result.text } : { shape: config.outputShape.id, text: stringsIn(output).join('\n'), value: output })
    } else rec.output({ text: result.text })
    return { status: 'done', runId, text: result.text, output, messages: [...messages, ...result.responseMessages], trace: rec.trace('complete') }
  }

  const lastUser = (messages: ModelMessage[]) => {
    const u = [...messages].reverse().find((m) => m.role === 'user')
    return !u ? '' : typeof u.content === 'string' ? u.content : (u.content as any[]).filter((p) => p.type === 'text').map((p) => p.text).join(' ')
  }
  const reasonFor = (toolName: string) => {
    const c = config.tools.find((t) => t.name === toolName)?.approvalCondition
    return c ? `asks a person first when ${describeCondition(c)}` : 'asks a person first'
  }

  async function pause(runId: string, now: string, persisted: ModelMessage[], requests: any[], rec: TraceRecorder, state: { executed: boolean }): Promise<RunResult> {
    const pending: PendingApproval[] = requests.map((p) => {
      const call = p.toolCall // live result.content carries the call inline
      const t = config.tools.find((x) => x.name === call.toolName)!
      rec.approvalRequested(p.approvalId, call.toolName, call.input)
      return {
        approvalId: p.approvalId, toolCallId: call.toolCallId, tool: call.toolName, input: call.input,
        deadline: t.approvalTimeout ? new Date(Date.parse(now) + t.approvalTimeout.afterMinutes * 60_000).toISOString() : null,
        then: t.approvalTimeout?.then ?? null,
      }
    })
    const trace = rec.trace('complete')
    try { await deps.pendingApprovals!.save({ runId, messages: persisted, pending, answers: {}, trace }) } catch (err) {
      throw new AgentRunError(`the pending run could not be saved: ${err instanceof Error ? err.message : String(err)}`, rec.trace('incomplete'), err, state.executed)
    }
    let sent = 0
    try {
      for (const pa of pending) {
        await deps.onApprovalRequest!({ runId, approvalId: pa.approvalId, tool: pa.tool, input: pa.input, reason: reasonFor(pa.tool), conversationSummary: lastUser(persisted).slice(0, 280), deadline: pa.deadline })
        sent++
      }
    } catch (err) {
      // The pause is saved: acted is true so a resumed segment never overwrites it with the older run. The error names what was not sent, so nobody is asked twice.
      const unsent = pending.slice(sent).map((p) => p.approvalId)
      throw Object.assign(new AgentRunError(`an approval request could not be sent for run ${runId}; not yet sent: ${unsent.join(', ')}: ${err instanceof Error ? err.message : String(err)}`, rec.trace('incomplete'), err, true), { runId, unsent })
    }
    return { status: 'paused', runId, pending: pending.map((p) => p.approvalId), trace }
  }

  /** Every put-back after a claim goes through here: one retry, then an error that carries the run. */
  async function saveBack(run: PausedRun, original?: unknown): Promise<void> {
    const store = deps.pendingApprovals!
    try { await store.save(run) } catch {
      try { await store.save(run) } catch (err) { throw new PausedRunLostError(run.runId, run, err, original) }
    }
  }
  const validTime = (v: string) => { if (!Number.isFinite(Date.parse(v))) throw new Error(`invalid time ${v}`) }
  const notPaused = (runId: string) => new Error(`run ${runId} is not paused (already resumed or expired)`)
  const asks = config.tools.some((t) => t.permission === 'asks-first')
  const open = (r: PausedRun) => r.pending.filter((p) => !r.answers[p.approvalId])

  /** `saved` was claimed (removed from the store) by the caller, with every approval answered. Restored only if nothing acted. */
  async function continueIfAnswered(saved: PausedRun, now: string, abortSignal?: AbortSignal): Promise<RunResult> {
    const store = deps.pendingApprovals!
    const start = Date.now()
    const fromStep = saved.trace.steps.length // before the answers are recorded: this segment's steps start here
    const before: Before = { usage: { ...saved.trace.usage }, outputs: { length: saved.trace.outputs.length } }
    const approvals = saved.pending.map((p) => ({ approvalId: p.approvalId, ...saved.answers[p.approvalId] }))
    const rec = TraceRecorder.from(saved.trace, offered)
    for (const p of saved.pending) { const a = saved.answers[p.approvalId]; rec.approvalAnswered(p.approvalId, a.approved, a.by, a.expired) }
    // Nothing has acted yet on this path, so a failure here restores the run.
    const fail = async (what: string, err: unknown): Promise<never> => {
      const failure = new AgentRunError(`${what}: ${err instanceof Error ? err.message : String(err)}`, rec.trace('incomplete'), err)
      emitFailed(failure, fromStep, start, approvals, before)
      await saveBack(saved, failure)
      throw failure
    }
    let off: boolean
    try { off = await deps.isOff() } catch (err) { return fail('the off-switch check failed', err) }
    if (off) {
      // Handler first, then mark: a failed handler must never leave a hand-off recorded.
      try { await deps.onHandOff({ runId: saved.runId, conversation: saved.messages, reason: 'off' }) } catch (err) { return fail('the hand-off handler failed', err) }
      rec.handOff('off')
      return observed({ status: 'handed-off', runId: saved.runId, reason: 'off', trace: rec.trace('complete') }, fromStep, start, approvals, before)
    }
    const response = { role: 'tool', content: saved.pending.map((p) => {
      const a = saved.answers[p.approvalId]
      return { type: 'tool-approval-response', approvalId: p.approvalId, approved: a.approved, ...(a.approved ? {} : { reason: a.expired ? 'No one answered in time.' : 'A person declined.' }) }
    }) } as unknown as ModelMessage
    try {
      return observed(await segment(saved.runId, now, [...saved.messages, response], rec, abortSignal), fromStep, start, approvals, before)
    } catch (e) {
      emitFailed(e, fromStep, start, approvals, before)
      // A run that fails approval verification would fail the same way on every retry and every sweep: never restored.
      if (e instanceof AgentRunError && failedVerification(e.cause)) throw new ApprovalVerificationError(saved.runId, e.trace, e.cause)
      // Restore only if no tool function was entered: a granted tool that already ran (even if it then threw) must never run twice on a retry.
      const acted = e instanceof AgentRunError ? e.acted : true
      if (!acted) await saveBack(saved, e) // keep the answers; resume (same approvalId) or the next expire sweep retries
      throw e
    }
  }

  async function resume(runId: string, approvalId: string, answer: ApprovalAnswer, opts: { abortSignal?: AbortSignal } = {}): Promise<RunResult> {
    if (!asks) throw new Error('this agent has no asks-first tools')
    validTime(answer.at)
    const store = deps.pendingApprovals!
    const loaded = await store.load(runId)
    if (!loaded) throw notPaused(runId)
    if (!loaded.pending.some((p) => p.approvalId === approvalId)) throw new Error(`run ${runId} is not waiting on approval ${approvalId}`)
    if (loaded.answers[approvalId]) {
      if (open(loaded).length) throw new Error(`approval ${approvalId} is already answered`)
      // Every approval is answered: a failed continuation restored this run. Resuming again is a retry of that continuation.
      if (loaded.answers[approvalId].approved !== answer.approved) throw new Error(`approval ${approvalId} is already answered`)
      const retry = await store.claim(runId)
      if (!retry) throw notPaused(runId)
      return continueIfAnswered(retry, answer.at, opts.abortSignal)
    }
    const run = await store.recordAnswer(runId, approvalId, answer)
    if (!run) throw notPaused(runId)
    const still = open(run)
    if (still.length) return { status: 'waiting', runId, pending: still.map((p) => p.approvalId) }
    const claimed = await store.claim(runId) // only one caller gets the run
    if (!claimed) throw notPaused(runId)
    return continueIfAnswered(claimed, answer.at, opts.abortSignal)
  }

  async function expire(now: string, opts: { abortSignal?: AbortSignal } = {}): Promise<RunResult[]> {
    const store = deps.pendingApprovals
    if (!asks || !store) return []
    validTime(now)
    const dueOf = (r: PausedRun) => open(r).filter((p) => p.deadline !== null && Date.parse(p.deadline) <= Date.parse(now))
    const results: RunResult[] = []
    const errors: unknown[] = []
    for (const listed of await store.list()) {
      try {
        // Claim first, then decide from the CLAIMED copy: a person may have answered since list().
        if (open(listed).length && !dueOf(listed).length) continue
        const claimed = await store.claim(listed.runId)
        if (!claimed) continue
        const due = dueOf(claimed)
        if (due.some((p) => p.then === 'hand-off')) {
          const start = Date.now()
          const fromStep = claimed.trace.steps.length
          const before: Before = { usage: { ...claimed.trace.usage }, outputs: { length: claimed.trace.outputs.length } }
          const approvals: SegmentInfo['approvals'] = claimed.pending.flatMap((p): SegmentInfo['approvals'] => {
            const a = claimed.answers[p.approvalId]
            return a ? [{ approvalId: p.approvalId, ...a }] : due.some((d) => d.approvalId === p.approvalId) ? [{ approvalId: p.approvalId, at: now, expired: true }] : []
          })
          const rec = TraceRecorder.from(claimed.trace, offered)
          // Everything a person already answered, in pending order, then the expired ones: the trace is complete (§9).
          for (const p of claimed.pending) { const a = claimed.answers[p.approvalId]; if (a) rec.approvalAnswered(p.approvalId, a.approved, a.by, a.expired) }
          for (const p of due) rec.approvalAnswered(p.approvalId, false, undefined, true)
          // Handler first, then mark; a failing handler puts the paused run back for the next sweep.
          try { await deps.onHandOff({ runId: claimed.runId, conversation: claimed.messages, reason: 'approval-expired' }) } catch (err) {
            const failure = new AgentRunError(`the hand-off handler failed: ${err instanceof Error ? err.message : String(err)}`, rec.trace('incomplete'), err)
            emitFailed(failure, fromStep, start, approvals, before)
            await saveBack(claimed, failure)
            throw failure
          }
          rec.handOff('approval-expired')
          results.push(observed({ status: 'handed-off', runId: claimed.runId, reason: 'approval-expired', trace: rec.trace('complete') }, fromStep, start, approvals, before))
          continue
        }
        for (const p of due) claimed.answers[p.approvalId] = { approved: false, at: now, expired: true }
        if (open(claimed).length) { await saveBack(claimed); continue }
        results.push(await continueIfAnswered(claimed, now, opts.abortSignal))
      } catch (e) { errors.push(e) }
    }
    if (errors.length) throw Object.assign(new AggregateError(errors, `${errors.length} paused run(s) failed to move on`), { results })
    return results
  }

  async function run(req: RunRequest): Promise<RunResult> {
    validTime(req.now)
    const start = Date.now()
    const rec = new TraceRecorder(header(req.runId), offered)
    rec.userMessage(req.message)
    const before: ModelMessage[] = req.history ?? (req.priorTurns ?? []).map((t) => ({ role: t.role, content: t.text }) as ModelMessage)
    const messages: ModelMessage[] = [...before, { role: 'user', content: req.message }]
    let off: boolean
    try { off = await deps.isOff() } catch (err) {
      return failed(new AgentRunError(`the off-switch check failed: ${err instanceof Error ? err.message : String(err)}`, rec.trace('incomplete'), err), 0, start)
    }
    if (off) {
      try { await deps.onHandOff({ runId: req.runId, conversation: messages, reason: 'off' }) } catch (err) {
        return failed(new AgentRunError(`the hand-off handler failed: ${err instanceof Error ? err.message : String(err)}`, rec.trace('incomplete'), err), 0, start)
      }
      rec.handOff('off')
      return observed({ status: 'handed-off', runId: req.runId, reason: 'off', trace: rec.trace('complete') }, 0, start)
    }
    return observed(await segment(req.runId, req.now, messages, rec, req.abortSignal).catch((e) => failed(e, 0, start)), 0, start)
  }

  return { run, resume, expire }
}
