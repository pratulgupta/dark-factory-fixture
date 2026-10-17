// GENERATED RUNTIME — copied verbatim by Kogent into agents/<name>/runtime/. Do not edit: edit the spec.
// Default fakes for case runs, built from the case's test world (§4.1 "Fakes"). Never used in production.
import { createHash } from 'node:crypto'
import type { Backend, DocumentStore, TestWorld, ToolConfig } from './types.ts'

export interface FakeCall { tool: string; input: unknown }

export function documentId(path: string, text: string): string {
  return createHash('sha256').update(`${path}\u0000${text}`).digest('hex').slice(0, 12)
}

export function fakeStore(world: TestWorld, documentsDir: string): DocumentStore {
  const docs = world.documents.filter((d) => d.path.startsWith(`${documentsDir}/`)).map((d) => ({ id: documentId(d.path, d.text), text: d.text }))
  return {
    search: async (query) => {
      const words = query.toLowerCase().split(/\W+/).filter((w) => w.length >= 3)
      return docs.filter((d) => !words.length || words.some((w) => d.text.toLowerCase().includes(w))).slice(0, 5)
    },
    get: async (id) => docs.find((d) => d.id === id) ?? null,
  }
}

export function synthesize(schema: unknown): unknown {
  if (!schema || typeof schema !== 'object') return null
  const s = schema as Record<string, any>
  if (Array.isArray(s.enum)) return s.enum[0] ?? null
  if ('const' in s) return s.const
  switch (s.type) {
    case 'boolean': return true
    case 'number': case 'integer': return 0
    case 'string': return ''
    case 'array': return []
    case 'object': return Object.fromEntries((s.required ?? []).map((k: string) => [k, synthesize(s.properties?.[k])]))
  }
  return null
}

export function fakeBackend(tool: ToolConfig, world: TestWorld): Backend {
  return async (input) => {
    const base = synthesize(tool.outputSchema) as Record<string, unknown>
    if (tool.effect !== 'reads') return base
    const given = Object.entries((input ?? {}) as Record<string, unknown>)
    const matches = world.rows.filter((r) => {
      const shared = given.filter(([k]) => Object.hasOwn(r.fields, k))
      return shared.length > 0 && shared.every(([k, v]) => r.fields[k] === String(v))
    })
    const arrayKey = Object.entries((tool.outputSchema.properties ?? {}) as Record<string, { type?: string }>).find(([, p]) => p?.type === 'array')?.[0]
    if (arrayKey) return { ...base, [arrayKey]: matches.map((m) => m.fields) }
    return { ...base, ...(matches[0]?.fields ?? {}) }
  }
}

export function makeFakesFor(tools: ToolConfig[], world: TestWorld, overrides: Record<string, (world: TestWorld) => Backend> = {}) {
  const calls: FakeCall[] = []
  const backends: Record<string, Backend> = {}
  const stores: Record<string, DocumentStore> = {}
  for (const t of tools) {
    if (t.permission === 'never') continue
    if (t.source) { stores[t.name] = fakeStore(world, t.source.documentsDir); continue }
    const inner = overrides[t.name]?.(world) ?? fakeBackend(t, world)
    backends[t.name] = async (input) => { calls.push({ tool: t.name, input }); return inner(input) }
  }
  return { backends, stores, calls }
}
