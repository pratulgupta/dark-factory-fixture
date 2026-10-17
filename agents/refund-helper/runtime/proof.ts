// GENERATED RUNTIME — copied verbatim by Kogent into agents/<name>/runtime/. Do not edit: edit the spec.
// The startup check (§8.6): is this directory the one Kogent proved? Intended, not enforced (§11).
import { createHash, verify } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'

export interface ProofRecord { format: 1; runId: string; buildKey: string; agentDirHash: string; aiVersion: string; reportedModel: string; casesHash: string; cases: unknown; signature: string; kid: string }
export interface ProofStatus { proven: boolean; reasons: string[]; reportedModel: string | null }

/** JSON with object keys sorted at every depth; `undefined` members dropped as JSON.stringify does. Kogent's signer uses this same function. */
export function canonicalJson(v: unknown): string {
  if (v === null || v === undefined || typeof v !== 'object') return JSON.stringify(v ?? null)
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`
}

const SKIP_DIRS = new Set(['node_modules'])
/** Written by package managers at the agent root, never by codegen (§8.6). */
const LOCKFILES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'])

/** The one skip rule, for a path relative to the agent root ('/'-separated): dot-paths (.DS_Store, .vscode/,
 *  .generated/: editors and tools, never codegen), anything under node_modules, proof.json and root lockfiles (§8.6).
 *  A directory is asked about as `<rel>/`. */
function hashed(rel: string): boolean {
  const parts = rel.split('/')
  if (parts.some((p) => p.startsWith('.')) || parts.slice(0, -1).some((p) => SKIP_DIRS.has(p))) return false
  return rel !== 'proof.json' && !(parts.length === 1 && LOCKFILES.has(rel))
}

/** Regular files and symlinks only. A symlink is hashed as its target string and never followed; sockets, FIFOs and devices are skipped. */
function files(root: string, dir = root): Array<{ rel: string; bytes: Buffer; link?: true }> {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    const rel = relative(root, p).split(sep).join('/')
    const st = lstatSync(p)
    if (st.isDirectory()) return hashed(`${rel}/`) ? files(root, p) : []
    if (!hashed(rel)) return []
    if (st.isSymbolicLink()) return [{ rel, bytes: Buffer.from(`link:${readlinkSync(p)}`), link: true }]
    return st.isFile() ? [{ rel, bytes: readFileSync(p) }] : []
  })
}

/** Per file: path NUL length NUL bytes NUL, in sorted path order. The length keeps file boundaries unambiguous. */
export function agentDirHash(dir: string): string { return hashOf(files(dir)) }
/** agentDirHash's algorithm over a file map (paths relative to agents/<name>/), with the same skips: proof.json, root
 *  lockfiles, dot-paths, node_modules. Kogent decides the kind of build with it (P4-R33). */
export function agentFilesHash(map: Record<string, string>): string {
  return hashOf(Object.entries(map).filter(([rel]) => hashed(rel)).map(([rel, s]) => ({ rel, bytes: Buffer.from(s, 'utf8') })))
}
function hashOf(list: ReturnType<typeof files>): string {
  const h = createHash('sha256')
  for (const f of list.sort((x, y) => (x.rel < y.rel ? -1 : x.rel > y.rel ? 1 : 0))) {
    h.update(f.rel); h.update('\u0000'); h.update(String(f.bytes.length)); h.update('\u0000'); h.update(f.bytes); h.update('\u0000')
  }
  return h.digest('hex')
}

export function casesHash(cases: unknown): string {
  return createHash('sha256').update(canonicalJson(cases ?? null)).digest('hex')
}

export function proofPayload(r: Pick<ProofRecord, 'format' | 'runId' | 'buildKey' | 'agentDirHash' | 'aiVersion' | 'reportedModel' | 'casesHash'>): string {
  return canonicalJson({ agentDirHash: r.agentDirHash, aiVersion: r.aiVersion, buildKey: r.buildKey, casesHash: r.casesHash, format: r.format, reportedModel: r.reportedModel, runId: r.runId })
}

export function resolvedPackageVersion(fromDir: string, name: string): string | null {
  for (let d = fromDir; ; d = dirname(d)) {
    const p = join(d, 'node_modules', name, 'package.json')
    if (existsSync(p)) { try { return String(JSON.parse(readFileSync(p, 'utf8')).version) } catch { return null } }
    if (dirname(d) === d) return null
  }
}

export function checkProof(opts: { dir: string; publicKeyPem: string }): ProofStatus {
  const path = join(opts.dir, 'proof.json')
  if (!existsSync(path)) return { proven: false, reasons: ['no proof.json'], reportedModel: null }
  let rec: ProofRecord
  try { rec = JSON.parse(readFileSync(path, 'utf8')) } catch { return { proven: false, reasons: ['proof.json is not readable'], reportedModel: null } }
  if (rec.format !== 1) return { proven: false, reasons: [`unknown proof format ${rec.format}`], reportedModel: null }
  const list = files(opts.dir)
  // Codegen never writes a symlink, so one in the tree is itself unproven: its target can change freely.
  const links = list.filter((f) => f.link).map((f) => `the generated files include a symlink: ${f.rel}`)
  const reasons: string[] = []
  let ok = false
  try { ok = !!opts.publicKeyPem && verify(null, Buffer.from(proofPayload(rec)), opts.publicKeyPem, Buffer.from(rec.signature, 'base64')) } catch { ok = false }
  if (!ok) reasons.push('proof.json signature does not verify', ...links)
  else {
    reasons.push(...links)
    if (casesHash(rec.cases) !== rec.casesHash) reasons.push('the proof verdicts changed after signing')
    if (hashOf(list) !== rec.agentDirHash) reasons.push('the generated files changed after proof')
    const ai = resolvedPackageVersion(opts.dir, 'ai')
    if (ai === null) reasons.push('ai version unknown')
    else if (ai !== rec.aiVersion) reasons.push(`ai ${ai} is not the proven ${rec.aiVersion}`)
  }
  return { proven: reasons.length === 0, reasons, reportedModel: ok ? rec.reportedModel : null }
}
