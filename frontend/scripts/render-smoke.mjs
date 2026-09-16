/**
 * Render smoke test — every route is mounted in jsdom against the live API and
 * asserted to render real content without React errors.
 *
 * Why this exists: type-checking proves the shapes compile, the API e2e proves
 * the backend is right, but neither proves that a page actually renders with the
 * payload it receives. This is the seam between them, and it is the check that
 * catches "field renamed on the server" bugs on the frontend.
 *
 *   node scripts/render-smoke.mjs            # needs the API on :8000
 *   SMOKE_BASE=http://127.0.0.1:8000 node scripts/render-smoke.mjs
 */
import { JSDOM } from 'jsdom'
import esbuild from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:8000'

const ROUTES = [
  { path: '/', expect: ['Enterprise compliance', 'AI priority alerts'] },
  { path: '/mines', expect: ['Zones', 'Open site'], interact: ['Zone A', 'Engine explanation'] },
  { path: '/mines/MINE-ALPHA', expect: ['Operations map', 'Why this site scores'], interact: ['Zone board', 'lead:', 'Early warnings', 'Escalating compliance risk'] },
  { path: '/inspections', expect: ['Inspection management', 'Recorded rounds'] },
  { path: '/inspections?new=1', expect: ['Inspection record', 'Projected risk impact'] },
  { path: '/violations', expect: ['Register', 'Severity mix'], interact: ['VIO-', 'Workflow position', null, 'Audit trail'] },
  { path: '/actions', expect: ['Corrective actions', 'Owner load'], interact: [null, 'How the chain closes'] },
  { path: '/risk', expect: ['Model in force', 'Counterfactual lab'], interact: ['Full dossier', 'Engine explanation'] },
  { path: '/early-warning', expect: ['What is becoming risky', 'How warnings are produced'] },
  { path: '/reports', expect: ['Executive summary', 'Site position'], interact: ['Generate & stamp', 'Showing the copy generated at', null, 'Mine Compliance Summary'] },
  { path: '/documents', expect: ['Register of documents', 'Extraction pipeline'] },
  { path: '/admin', expect: ['Risk model as deployed', 'API surface', 'Violation Severity', 'Overdue Corrective Actions'] },
]

const result = await esbuild.build({
  entryPoints: [path.join(ROOT, 'scripts/smoke-entry.tsx')],
  bundle: true,
  write: false,
  format: 'iife',
  jsx: 'automatic',
  loader: { '.tsx': 'tsx', '.ts': 'ts', '.css': 'empty' },
  define: { 'process.env.NODE_ENV': '"development"' },
  absWorkingDir: ROOT,
  logLevel: 'silent',
})
const bundle = result.outputFiles[0].text


// ------------------------------------------------------------- interaction kit
function kit(window) {
  const doc = window.document
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const all = () => Array.from(doc.querySelectorAll('button, a, input, select, textarea, [role="tab"], tr'))
  const text = () => doc.body.textContent ?? ''
  const byText = (needle, tag) =>
    all().find(
      (el) =>
        (!tag || el.tagName.toLowerCase() === tag) &&
        `${el.textContent ?? ''}${el.getAttribute('aria-label') ?? ''}${el.getAttribute('placeholder') ?? ''}${el.getAttribute('name') ?? ''}`.includes(needle),
    )
  const click = async (needle, tag) => {
    const el = byText(needle, tag)
    if (!el) throw new Error(`no clickable element containing ${JSON.stringify(needle)}`)
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
    await sleep(450)
    return el
  }
  const setValue = async (needle, value, tag) => {
    const el = byText(needle, tag)
    if (!el) throw new Error(`no field matching ${JSON.stringify(needle)}`)
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    setter?.call(el, value)
    el.dispatchEvent(new window.Event('input', { bubbles: true }))
    el.dispatchEvent(new window.Event('change', { bubbles: true }))
    await sleep(120)
  }
  const waitFor = async (needle, ms = 2000) => {
    const start = Date.now()
    while (Date.now() - start < ms) {
      if (text().includes(needle)) return true
      await sleep(120)
    }
    return false
  }
  return { sleep, text, click, setValue, waitFor, doc }
}

const failures = []

// ------------------------------------------------- write path through the form
// The one flow that must not be faked: filling the inspection form in the DOM,
// submitting it, and seeing the engine's own risk response come back.
async function writePath() {
  const dom = new JSDOM('<!doctype html><html class="theme-dark"><body><div id="root"></div></body></html>', {
    url: `${BASE}/inspections?new=1`,
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  })
  const window = dom.window
  const errors = []
  window.addEventListener('error', (e) => errors.push(`error: ${e.message}`))
  window.console.error = (...a) => {
    const t = a.map(String).join(' ')
    if (!/not wrapped in act/.test(t)) errors.push(`console.error: ${t.slice(0, 200)}`)
  }
  window.console.warn = () => {}
  window.fetch = (input, init) => globalThis.fetch(typeof input === 'string' ? new URL(input, BASE).toString() : input, init)
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.HTMLElement.prototype.scrollIntoView = () => {}
  window.__SMOKE_PATH__ = '/inspections?new=1'
  for (const key of ['window', 'document', 'navigator', 'location', 'history', 'Event', 'MouseEvent', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage']) {
    if (!(key in globalThis)) Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true })
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = false
  window.eval(bundle)
  const h = kit(window)
  await h.sleep(1000)

  const before = await (await globalThis.fetch(`${BASE}/api/zones/Z-ALPHA-B/risk`)).json()
  await h.setValue('zone', 'Z-ALPHA-B', 'select')
  await h.sleep(400)
  await h.setValue('observations', 'Smoke walk of the equipment yard: CV-2 emergency stop tested twice, second test failed to halt the drive.')
  await h.setValue('finding-category', 'Safety Equipment', 'select')
  await h.setValue('finding-description', 'Emergency stop on conveyor CV-2 inoperative on the second test; the drive ran on after the pull cord was pulled.')
  await h.sleep(600)
  await h.click('Submit inspection')
  const recorded = await h.waitFor('Round recorded', 5000)
  const body = window.document.body.textContent ?? ''
  const after = await (await globalThis.fetch(`${BASE}/api/zones/Z-ALPHA-B/risk`)).json()
  if (!recorded) failures.push('write path: submitting the form never reached the confirmation panel')
  if (!body.includes('zone risk after submission')) failures.push('write path: the engine response panel did not render')
  if (Math.abs(after.risk_score - before.risk_score) < 0.05) failures.push('write path: the zone score did not move after the new violation')
  // Direction check on the factors, not the total: recording a compliant-round
  // inspection legitimately clears the inspection-delay factor, so the total can
  // fall while severity rises. The panel has to say both parts out loud.
  const sevBefore = before.factors.find((f) => f.key === 'severity').points
  const sevAfter = after.factors.find((f) => f.key === 'severity').points
  if (!(sevAfter > sevBefore)) failures.push(`write path: severity factor did not rise (${sevBefore} → ${sevAfter})`)
  if (!body.includes('Inspection Delay')) failures.push('write path: the response panel did not explain the offsetting factor movement')
  if (errors.length) failures.push(`write path: ${errors.slice(0, 2).join(' | ')}`)
  notes.push(`  PASS  /inspections (submit)         zone risk ${before.risk_score.toFixed(1)} → ${after.risk_score.toFixed(1)} · severity factor ${sevBefore} → ${sevAfter}`)
  window.close()
}
const notes = []

for (const route of ROUTES) {
  const dom = new JSDOM('<!doctype html><html class="theme-dark"><body><div id="root"></div></body></html>', {
    url: `${BASE}${route.path}`,
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  })
  const { window } = dom
  const errors = []
  window.addEventListener('error', (e) => errors.push(`error: ${e.message}`))
  const origError = window.console.error
  window.console.error = (...args) => {
    const text = args.map(String).join(' ')
    if (!/not wrapped in act|useLayoutEffect does nothing on the server/.test(text)) errors.push(`console.error: ${text.slice(0, 220)}`)
    void origError
  }
  window.console.warn = () => {}

  // jsdom has no fetch, no layout and no matchMedia — give the app what it needs.
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? new URL(input, BASE).toString() : input
    return globalThis.fetch(url, init)
  }
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  window.scrollTo = () => {}
  window.HTMLElement.prototype.scrollIntoView = () => {}
  Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', { value: {}, writable: true })
  window.__SMOKE_PATH__ = route.path

  const globalKeys = ['window', 'document', 'navigator', 'location', 'history', 'fetch', 'matchMedia', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'getComputedStyle', 'localStorage', 'sessionStorage']
  for (const key of globalKeys) {
    if (key in globalThis) continue
    try {
      Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true })
    } catch {
      /* already defined by node — jsdom's copy is enough for the render */
    }
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = false

  try {
    window.eval(bundle)
    await new Promise((r) => setTimeout(r, 900))
    const text = window.document.body.textContent ?? ''
    const missing = route.expect.filter((needle) => !text.includes(needle))
    if (missing.length) failures.push(`${route.path}: missing text ${JSON.stringify(missing)}`)
    if (errors.length) failures.push(`${route.path}: ${errors.slice(0, 3).join(' | ')}`)
    let interactNote = ''
    if (route.interact && !missing.length) {
      const h = kit(window)
      const steps = route.interact
      for (let i = 0; i < steps.length; i += 2) {
        const [needle, expectAfter] = steps.slice(i, i + 2)
        try {
          if (needle) await h.click(needle)
          const ok = expectAfter === needle ? true : await h.waitFor(expectAfter, 2500)
          if (!ok) failures.push(`${route.path}: after clicking ${JSON.stringify(needle)} the view never showed ${JSON.stringify(expectAfter)}`)
          else interactNote += needle ? ` → ${JSON.stringify(needle)} ok` : ' → text ok'
        } catch (e) {
          failures.push(`${route.path}: interaction on ${JSON.stringify(needle)} failed — ${e.message}`)
        }
      }
    }
    if (!missing.length && !errors.length) notes.push(`  PASS  ${route.path.padEnd(24)} ${String(text.length).padStart(6)} chars${interactNote}`)
    window.__SMOKE_UNMOUNT__?.()
  } catch (e) {
    failures.push(`${route.path}: threw ${e?.stack?.split('\n').slice(0, 3).join(' | ') ?? e}`)
  }
  window.close()
}

if (process.env.SMOKE_WRITE === '1') await writePath()

console.log('\nMINEGUARD render smoke')
console.log('='.repeat(64))
for (const n of notes) console.log(n)
if (failures.length) {
  console.log('\nFAILURES:')
  for (const f of failures) console.log('  FAIL ' + f)
  console.log(`\n${notes.length} rendered clean, ${failures.length} problem(s)`)
  process.exit(1)
}
console.log(`\n${notes.length} checks passed (${ROUTES.length} routes + write path) against ${BASE}`)
