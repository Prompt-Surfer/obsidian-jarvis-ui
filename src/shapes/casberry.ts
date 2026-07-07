// Community Cloud provider: loads particle formations published on
// particles.casberry.in (AI Particle Architect) and adapts them into
// ImportedShapeDefs. Formations live in a world-readable Firestore
// collection; each doc holds a JS function body executed per particle with
// (i, count, target, color, THREE, time, setInfo, annotate, addControl).
// We compile that body statically (time = 0, slider defaults baked in),
// validate it against the same kind of blocklist the upstream site uses,
// and auto-normalize its world scale to jarvis units.
import type { ImportedShapeDef } from './types'

const PROJECT = 'drone-swarm-1a6a2'
// Public browser key shipped in the site's own main.js — not a secret.
const API_KEY = 'AIzaSyADPywVsfmTEslepJzWu8vbaX0YwbkdA2A'
const DOCS_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`

export const CASBERRY_PREFIX = 'imported:casberry:'

export function casberryShapeId(name: string): `imported:${string}` {
  return `${CASBERRY_PREFIX}${name}` as `imported:${string}`
}

export function casberryShapeName(shape: string): string | null {
  return shape.startsWith(CASBERRY_PREFIX) && shape.length > CASBERRY_PREFIX.length
    ? shape.slice(CASBERRY_PREFIX.length)
    : null
}

/**
 * Accepts a formation name ("JARVIS MATRIX") or a particles.casberry.in URL
 * with a ?sim= param — which arrives double-encoded when copied from the
 * browser ("JARVIS%2520MATRIX").
 */
export function parseCasberryInput(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (!/^https?:\/\//i.test(trimmed)) return trimmed
  try {
    let sim = new URL(trimmed).searchParams.get('sim')
    if (!sim) return null
    for (let guard = 0; guard < 4 && /%[0-9a-fA-F]{2}/.test(sim); guard++) {
      const decoded = decodeURIComponent(sim)
      if (decoded === sim) break
      sim = decoded
    }
    return sim || null
  } catch {
    return null
  }
}

// Same spirit as the upstream publish-time validator, but tuned for the Worker
// context we compile into (Workers have fetch/self/importScripts/postMessage).
// We deny escape hatches out of the position-function sandbox WITHOUT rejecting
// ordinary code: the sandbox-escape vector is DOTTED property access
// (`x.constructor.constructor`, `x.prototype`, `__proto__`), so we block those
// rather than the bare words — that lets formations define ES6 classes
// (`constructor(x, y) {}`) or mention "prototype" in a comment, exactly as
// upstream allows. Dynamic eval is blocked as `eval(` / `Function(` (incl.
// `new Function`), not the bare identifier.
const BLOCKED_PATTERNS: Array<[RegExp, string]> = [
  [/\bdocument\b/, 'document'],
  [/\bwindow\b/, 'window'],
  [/\bglobalThis\b/, 'globalThis'],
  [/\bself\b/, 'self'],
  [/\blocation\b/, 'location'],
  [/\bnavigator\b/, 'navigator'],
  [/\bfetch\b/, 'fetch'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest'],
  [/\bWebSocket\b/, 'WebSocket'],
  [/\bimportScripts\b/, 'importScripts'],
  [/\bpostMessage\b/, 'postMessage'],
  [/\bonmessage\b/, 'onmessage'],
  [/\beval\s*\(/, 'eval('],
  [/\bFunction\s*\(/, 'Function('],
  [/\bimport\s*[(\s]/, 'import'],
  [/\brequire\s*\(/, 'require('],
  [/\bprocess\b/, 'process'],
  [/\bmodule\b/, 'module'],
  [/\.\s*constructor\b/, '.constructor'],
  [/\.\s*prototype\b/, '.prototype'],
  [/__proto__/, '__proto__'],
  [/\blocalStorage\b/, 'localStorage'],
  [/\bsessionStorage\b/, 'sessionStorage'],
  [/\bindexedDB\b/, 'indexedDB'],
  [/\bsetTimeout\b/, 'setTimeout'],
  [/\bsetInterval\b/, 'setInterval'],
]

export function validateFormationCode(code: string): string | null {
  for (const [pattern, label] of BLOCKED_PATTERNS) {
    if (pattern.test(code)) return `blocked token "${label}"`
  }
  return null
}

export interface CasberryFormation {
  name: string
  publisher: string
  code: string
}

export async function fetchFormation(name: string): Promise<CasberryFormation> {
  // Most formations are keyed by their display name
  const direct = await fetch(`${DOCS_URL}/formations/${encodeURIComponent(name)}?key=${API_KEY}`)
  if (direct.ok) return docToFormation(await direct.json())
  // Others have random doc ids — fall back to a query on the name field
  const q = await fetch(`${DOCS_URL}:runQuery?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'formations' }],
        where: { fieldFilter: { field: { fieldPath: 'name' }, op: 'EQUAL', value: { stringValue: name } } },
        limit: 1,
      },
    }),
  })
  if (!q.ok) throw new Error(`community cloud query failed (HTTP ${q.status})`)
  const rows = (await q.json()) as Array<{ document?: unknown }>
  const doc = rows.find((r) => r.document)?.document
  if (!doc) throw new Error(`formation "${name}" not found in community cloud`)
  return docToFormation(doc)
}

export interface CatalogEntry {
  name: string
  publisher: string
}

/** Share URL in the site's own format. */
export function casberryShareUrl(name: string): string {
  return `https://particles.casberry.in/?sim=${encodeURIComponent(name)}`
}

/**
 * Full community catalog, mirroring upstream's gallery query
 * (orderBy timestamp desc) but projecting name+publisher only and paging
 * through the whole collection instead of infinite-scrolling 30 at a time.
 */
export async function fetchFormationCatalog(): Promise<CatalogEntry[]> {
  const entries: CatalogEntry[] = []
  const seen = new Set<string>()
  const PAGE = 300
  const MAX_DOCS = 5000 // hard stop — the collection is ~830 today
  for (let offset = 0; offset < MAX_DOCS; offset += PAGE) {
    const res = await fetch(`${DOCS_URL}:runQuery?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'formations' }],
          orderBy: [{ field: { fieldPath: 'timestamp' }, direction: 'DESCENDING' }],
          select: { fields: [{ fieldPath: 'name' }, { fieldPath: 'publisher' }] },
          limit: PAGE,
          offset,
        },
      }),
    })
    if (!res.ok) throw new Error(`catalog fetch failed (HTTP ${res.status})`)
    const rows = (await res.json()) as Array<{ document?: FirestoreDoc }>
    const docs = rows.filter((r) => r.document)
    for (const r of docs) {
      const n = r.document ? docDisplayName(r.document) : ''
      if (n && !seen.has(n)) {
        seen.add(n)
        entries.push({ name: n, publisher: r.document?.fields?.publisher?.stringValue?.trim() ?? '' })
      }
    }
    if (docs.length < PAGE) break
  }
  return entries
}

interface FirestoreDoc {
  name?: string // full resource path — last segment is the doc id
  fields?: Record<string, { stringValue?: string }>
}

// Some docs (e.g. BLACKHOLE.01) have no `name` field — their doc id IS the name
function docDisplayName(doc: FirestoreDoc): string {
  const field = doc.fields?.name?.stringValue?.trim()
  if (field) return field
  const id = doc.name?.split('/').pop() ?? ''
  try { return decodeURIComponent(id) } catch { return id }
}

function docToFormation(doc: unknown): CasberryFormation {
  const d = doc as FirestoreDoc
  const f = d.fields ?? {}
  const code = f.code?.stringValue ?? ''
  if (!code) throw new Error('formation has no code field')
  return { name: docDisplayName(d), publisher: f.publisher?.stringValue ?? 'unknown', code }
}

// Minimal THREE shim — enough for the annotate/vector math formations use.
class Vec3 {
  x: number
  y: number
  z: number
  constructor(x = 0, y = 0, z = 0) {
    this.x = x
    this.y = y
    this.z = z
  }
  set(x: number, y: number, z: number) {
    this.x = x
    this.y = y
    this.z = z
    return this
  }
  copy(v: Vec3) {
    return this.set(v.x, v.y, v.z)
  }
  clone() {
    return new Vec3(this.x, this.y, this.z)
  }
  add(v: Vec3) {
    return this.set(this.x + v.x, this.y + v.y, this.z + v.z)
  }
  sub(v: Vec3) {
    return this.set(this.x - v.x, this.y - v.y, this.z - v.z)
  }
  multiplyScalar(s: number) {
    return this.set(this.x * s, this.y * s, this.z * s)
  }
  length() {
    return Math.hypot(this.x, this.y, this.z)
  }
  normalize() {
    const l = this.length() || 1
    return this.multiplyScalar(1 / l)
  }
}

// Chainable inert value: any property access, call, or construction returns
// itself, and numeric coercion yields 0. Used for `color` (we ignore formation
// colors — jarvis colours by folder) and for THREE members we don't model,
// so formations using e.g. color.setHex()/THREE.Color.lerp() run instead of
// crashing the compile probe.
function makeInert(): unknown {
  // Target MUST be a plain function (not an arrow) so the Proxy is constructable
  // — `new THREE.Color()` and friends fail with "not a constructor" otherwise.
  function fn() {}
  const inert: ReturnType<typeof Object> = new Proxy(fn, {
    get: (_t, prop) => {
      // Coerce to 0 for numbers and '' for strings so `color.r * 2` etc. stay finite
      if (prop === Symbol.toPrimitive) return () => 0
      if (prop === 'valueOf') return () => 0
      return inert
    },
    apply: () => inert,
    construct: () => inert as object,
  })
  return inert
}
const INERT = makeInert()

const THREE_SHIM_KNOWN: Record<string, unknown> = {
  Vector3: Vec3,
  MathUtils: {
    lerp: (a: number, b: number, t: number) => a + (b - a) * t,
    clamp: (v: number, mn: number, mx: number) => Math.min(mx, Math.max(mn, v)),
    smoothstep: (x: number, mn: number, mx: number) => {
      const t = Math.min(1, Math.max(0, (x - mn) / (mx - mn)))
      return t * t * (3 - 2 * t)
    },
    mapLinear: (x: number, a1: number, a2: number, b1: number, b2: number) => b1 + ((x - a1) * (b2 - b1)) / (a2 - a1),
    degToRad: (d: number) => (d * Math.PI) / 180,
    radToDeg: (r: number) => (r * 180) / Math.PI,
    randFloat: (lo: number, hi: number) => lo + (hi - lo) * 0.5,
    randFloatSpread: () => 0,
    euclideanModulo: (n: number, m: number) => ((n % m) + m) % m,
  },
}

// Unknown THREE members (Color, Quaternion, …) resolve to the inert value
const THREE_SHIM = new Proxy(THREE_SHIM_KNOWN, {
  get: (t, prop: string) => (prop in t ? t[prop] : INERT),
})

const noop = () => {}
// Sliders resolve to their published default value
const addControl = (_id: string, _label: string, _min: number, _max: number, initial?: number) =>
  initial ?? _min

/** Compile a formation body into a position function (time=0 unless passed). */
export function compileFormation(code: string): (i: number, count: number, time?: number) => { x: number; y: number; z: number } {
  const rejected = validateFormationCode(code)
  if (rejected) throw new Error(`formation code rejected: ${rejected}`)
  // eslint-disable-next-line no-new-func
  const body = new Function('i', 'count', 'target', 'color', 'THREE', 'time', 'setInfo', 'annotate', 'addControl', code)
  const target = new Vec3()
  const color = INERT // formation colors are ignored; accept any method chain
  return (i: number, count: number, time = 0) => {
    target.set(0, 0, 0)
    body(i, count, target, color, THREE_SHIM, time, noop, noop, addControl)
    return { x: target.x, y: target.y, z: target.z }
  }
}

// Formations use arbitrary world scales (built-ins ~15-30 units, community
// 50-600). Probe the function and normalize its bounding radius to jarvis
// units so every loaded shape lands at a sensible size.
const NORMALIZED_RADIUS = 280
const PROBE_SAMPLES = 2048
const PROBE_COUNT = 10000

export function casberryShapeDef(formation: CasberryFormation): ImportedShapeDef {
  const raw = compileFormation(formation.code)
  let maxR = 0
  let finite = 0
  // Probe several time values: many formations grow FROM the origin with
  // time (explosions, waves) and are all-zero at exactly t=0.
  const PROBE_TIMES = [0, 1.37, 4.2]
  for (let k = 0; k < PROBE_SAMPLES; k++) {
    let anyFinite = false
    for (const pt of PROBE_TIMES) {
      const p = raw(Math.floor((k / PROBE_SAMPLES) * PROBE_COUNT), PROBE_COUNT, pt)
      if (Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)) {
        anyFinite = true
        maxR = Math.max(maxR, Math.hypot(p.x, p.y, p.z))
      }
    }
    if (anyFinite) finite++
  }
  // Mirror upstream's sanitation lock: it never rejects a formation, it just
  // resets non-finite targets to the origin every frame (some published
  // formations, e.g. BLACKHOLE.01, emit NaN for whole zones via masked sums).
  // Reject only when NOTHING is finite; scale comes from the finite samples.
  if (finite === 0 || maxR < 1e-6) {
    throw new Error(`formation "${formation.name}" failed the stability probe (finite=${finite}, maxR=${maxR})`)
  }
  if (finite < PROBE_SAMPLES * 0.9) {
    console.warn(`[casberry] "${formation.name}": ${PROBE_SAMPLES - finite}/${PROBE_SAMPLES} probe samples non-finite — those particles sit at the origin (matches upstream behaviour)`)
  }
  const scale = NORMALIZED_RADIUS / maxR
  return {
    id: `casberry:${formation.name}`,
    label: formation.name,
    icon: '☁️',
    source: `particles.casberry.in community formation "${formation.name}" by ${formation.publisher}`,
    animated: /\btime\b/.test(formation.code),
    position(i, count, _rng, time = 0) {
      const p = raw(i, count, time)
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return { x: 0, y: 0, z: 0 }
      return { x: p.x * scale, y: p.y * scale, z: p.z * scale }
    },
  }
}
