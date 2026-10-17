// GENERATED RUNTIME — copied verbatim by Kogent into agents/<name>/runtime/. Do not edit: edit the spec.
// The closed condition grammar shared by approvals and hard limits (agent specs §4.3).
export type ConditionOp = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq' | 'in'
export type ConditionValue = string | number | boolean | Array<string | number>
export interface ConditionTerm { field: string; op: ConditionOp; value: ConditionValue }
export type Condition = ConditionTerm | { all: ConditionTerm[] } | { any: ConditionTerm[] }
export interface Refusal { refused: true; reason: string }

const read = (input: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((v, k) => (v !== null && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), input)

// Precondition: the AI SDK validates tool input against the tool's inputSchema before
// toolApproval and execute run, so a missing or mismatched field fails open (never
// matches) by design. A type mismatch never matches for ANY op, including neq.
function term(t: ConditionTerm, input: unknown): boolean {
  const v = read(input, t.field)
  if (v === undefined || v === null) return false
  const num = typeof v === 'number' && typeof t.value === 'number'
  switch (t.op) {
    case 'gt': return num && (v as number) > (t.value as number)
    case 'gte': return num && (v as number) >= (t.value as number)
    case 'lt': return num && (v as number) < (t.value as number)
    case 'lte': return num && (v as number) <= (t.value as number)
    case 'eq': return v === t.value
    case 'neq': return typeof v === typeof t.value && v !== t.value
    case 'in': return Array.isArray(t.value) && (typeof v === 'string' || typeof v === 'number') && t.value.includes(v)
  }
}

export function holds(c: Condition, input: unknown): boolean {
  if ('all' in c) return c.all.every((t) => term(t, input))
  if ('any' in c) return c.any.some((t) => term(t, input))
  return term(c, input)
}

const SYMBOL: Record<ConditionOp, string> = { gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=', neq: '≠', in: 'is one of' }
const words = (t: ConditionTerm) => `${t.field} ${SYMBOL[t.op]} ${Array.isArray(t.value) ? t.value.join(', ') : String(t.value)}`

export function describeCondition(c: Condition): string {
  if ('all' in c) return c.all.map(words).join(' and ')
  if ('any' in c) return c.any.map(words).join(' or ')
  return words(c)
}

/** The guard compiled into a tool: the first hard limit that holds refuses the call. */
export function refuseIf(limits: readonly Condition[], input: unknown): Refusal | null {
  const hit = limits.find((l) => holds(l, input))
  return hit ? { refused: true, reason: `Refused by a hard limit: ${describeCondition(hit)}.` } : null
}

export function isRefusal(v: unknown): v is Refusal {
  return v !== null && typeof v === 'object' && (v as { refused?: unknown }).refused === true
}
