// GENERATED RUNTIME — copied verbatim by Kogent into agents/<name>/runtime/. Do not edit: edit the spec.
// An in-memory pending-approval store. Fine for development and case runs; production supplies a durable one (§8.2).
import type { PausedRun, PendingApprovalStore } from './types.ts'

export function memoryApprovalStore(): PendingApprovalStore {
  const rows = new Map<string, string>()
  return {
    save: async (run) => { rows.set(run.runId, JSON.stringify(run)) },
    load: async (runId) => { const s = rows.get(runId); return s ? (JSON.parse(s) as PausedRun) : null },
    delete: async (runId) => { rows.delete(runId) },
    list: async () => [...rows.values()].map((s) => JSON.parse(s) as PausedRun),
    // Both run synchronously before any await, which makes them atomic in JS.
    recordAnswer: async (runId, approvalId, answer) => {
      const s = rows.get(runId)
      if (!s) return null
      const run = JSON.parse(s) as PausedRun
      if (run.answers[approvalId]) throw new Error(`approval ${approvalId} is already answered`)
      run.answers[approvalId] = answer
      rows.set(runId, JSON.stringify(run))
      return JSON.parse(JSON.stringify(run)) as PausedRun
    },
    claim: async (runId) => {
      const s = rows.get(runId)
      if (!s) return null
      rows.delete(runId)
      return JSON.parse(s) as PausedRun
    },
  }
}
