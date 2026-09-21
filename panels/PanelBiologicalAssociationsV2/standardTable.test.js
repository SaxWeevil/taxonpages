import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'
import * as vue from 'vue'

// panelBehavior.test.js replaces every .vue import with {}, so the Standard
// table's own setup -- the evidence dots and the row grouping it renders --
// is not covered there. Run its real <script setup> the same way
// advancedTable.test.js runs the Advanced table's.
const filename = new URL('./StandardAssociationsTable.vue', import.meta.url)
const { descriptor } = parse(readFileSync(filename, 'utf8'))
const compiled = compileScript(descriptor, { id: 'standard-table-test', genDefaultAs: 'component' })
const body = compiled.content.replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '')

async function createTable(t, sections = []) {
  const imports = {}
  for (const [local, binding] of Object.entries(compiled.imports)) {
    if (binding.source === 'vue') {
      imports[local] = ['onMounted', 'onBeforeUnmount'].includes(binding.imported)
        ? () => {} : vue[binding.imported]
    } else if (binding.source.endsWith('.vue')) {
      imports[local] = {}
    } else {
      imports[local] = (await import(new URL(binding.source, filename)))[binding.imported]
    }
  }
  const component = new Function(...Object.keys(imports), body + '\nreturn component')(...Object.values(imports))
  const props = vue.reactive({ sections })
  const scope = vue.effectScope()
  t.after(() => scope.stop())
  return scope.run(() => component.setup(props, { expose() {} }))
}

const group = (counts, extra = {}) => ({
  key: 'taxon:1', name: 'Dianthus carthusianorum', italic: true, otuId: 1,
  families: ['Caryophyllaceae'], parts: ['leaf'],
  ids: [], count: Object.values(counts).reduce((sum, n) => sum + n, 0),
  counts: { confirmed: 0, weak: 0, excluded: 0, ...counts }, ...extra
})

test('a row renders the one dot its best evidence earns', async t => {
  const state = await createTable(t)
  const best = counts => state.bestMark(group(counts))
  assert.equal(best({ confirmed: 3 }).class, 'text-success')
  assert.equal(best({ weak: 1 }).class, 'text-warning')
  assert.equal(best({ excluded: 7 }).class, 'text-danger')
  // A mixed row reads as its best record, not as its worst.
  assert.equal(best({ confirmed: 2, weak: 5, excluded: 30 }).class, 'text-success')
  assert.equal(best({ weak: 5, excluded: 30 }).class, 'text-warning')
})

test('the dot carries its own category count, and its title the whole share', async t => {
  const state = await createTable(t)
  const mark = state.bestMark(group({ confirmed: 8, weak: 3 }))
  assert.equal(mark.count, 8)
  assert.equal(mark.title, '8 of 11 records: immature stage, or adult reared from (including galls) or feeding observed in the wild')
})

test('a row without counts gets no dot rather than an invented colour', async t => {
  const state = await createTable(t)
  assert.equal(state.bestMark({ count: 0, name: 'X' }), null)
})

test('sections keep their rows grouped by family for the table body', async t => {
  const rows = [
    group({ confirmed: 1 }, { key: 'taxon:1', name: 'Dianthus carthusianorum' }),
    group({ weak: 2 }, { key: 'taxon:2', name: 'Achillea millefolium', families: ['Asteraceae'] })
  ]
  const state = await createTable(t, [{ heading: 'As subject', rows }])
  const [section] = state.visibleSections.value
  assert.deepEqual(section.families.map(family => family.name), ['Asteraceae', 'Caryophyllaceae'])
  assert.deepEqual(section.families.map(family => family.rows.length), [1, 1])
  assert.deepEqual(state.visibleParts.value, ['leaf'])
})

// The dot only stays in one column because every count reserves the same
// width -- but reserving a fixed three digits wastes two digit widths per row.
test('the count reserves only as many digits as the widest count needs', async t => {
  const rows = [
    group({ confirmed: 7 }),
    group({ weak: 120 }, { key: 'taxon:2', name: 'Achillea millefolium' })
  ]
  const state = await createTable(t, [{ heading: 'As subject', rows }])
  assert.equal(state.maxCountDigits.value, 3)
})

test('two-digit counts do not reserve a third digit', async t => {
  const state = await createTable(t, [{ heading: 'As subject', rows: [group({ confirmed: 14 })] }])
  assert.equal(state.maxCountDigits.value, 2)
})

test('an empty table still reserves one digit', async t => {
  const state = await createTable(t)
  assert.equal(state.maxCountDigits.value, 1)
})

// The dot group is the only way into a row's breakdown on a touch device, so
// its open/close bookkeeping is worth pinning down. One popover serves the
// whole table; the trigger element moves to whichever row is active.
function withHover(t, matches) {
  const saved = 'window' in globalThis ? globalThis.window : undefined
  const had = 'window' in globalThis
  globalThis.window = { ...(saved || {}), matchMedia: () => ({ matches }) }
  t.after(() => {
    if (had) globalThis.window = saved
    else delete globalThis.window
  })
}

const rowsSection = (...rows) => [{ heading: 'As subject', rows }]
const stubEvent = () => ({ currentTarget: { tag: 'button' } })

test('tapping the dots opens that row, tapping again closes it', async t => {
  const row = group({ confirmed: 3 })
  const state = await createTable(t, rowsSection(row))
  assert.equal(state.activeRow.value, null)

  state.toggleMarks(row, stubEvent())
  assert.equal(state.activeRow.value.key, 'taxon:1')
  state.toggleMarks(row, stubEvent())
  assert.equal(state.activeRow.value, null)
})

test('tapping another row moves the single popover instead of opening a second', async t => {
  const first = group({ confirmed: 3 })
  const second = group({ weak: 2 }, { key: 'taxon:2', name: 'Achillea millefolium' })
  const state = await createTable(t, rowsSection(first, second))

  state.toggleMarks(first, stubEvent())
  state.toggleMarks(second, stubEvent())
  assert.equal(state.activeRow.value.key, 'taxon:2')
})

test('closeMarks clears the click flag and the hover flag together', async t => {
  withHover(t, true)
  const row = group({ confirmed: 3 })
  const state = await createTable(t, rowsSection(row))

  state.hoverMarks(row, stubEvent())
  state.toggleMarks(row, stubEvent())
  state.closeMarks()
  // A hover flag left behind would stop the next tap from closing.
  assert.equal(state.activeRow.value, null)
})

test('hover is ignored without a hovering pointer, so a tap is not stuck open', async t => {
  const row = group({ confirmed: 3 })
  const state = await createTable(t, rowsSection(row))

  withHover(t, false)
  state.hoverMarks(row, stubEvent())
  assert.equal(state.activeRow.value, null)

  globalThis.window.matchMedia = () => ({ matches: true })
  state.hoverMarks(row, stubEvent())
  assert.equal(state.activeRow.value.key, 'taxon:1')
  state.clearHoverMarks()
  assert.equal(state.activeRow.value, null)
})

test('a row leaving the table takes its popover with it', async t => {
  const row = group({ confirmed: 3 })
  // Reactive, so removing the row actually invalidates the computed chain the
  // popover resolves through -- the same way a prop change would.
  const sections = vue.reactive([{ heading: 'As subject', rows: [row] }])
  const state = await createTable(t, sections)

  state.toggleMarks(row, stubEvent())
  assert.equal(state.activeRow.value.key, 'taxon:1')
  // What a page change or a new taxon does.
  sections[0].rows = []
  assert.equal(state.activeRow.value, null)
})

test('the dot group names its whole breakdown, so it needs no visible text', async t => {
  const state = await createTable(t)
  const label = state.marksLabel(group({ confirmed: 8, weak: 3 }))
  assert.ok(label.includes('8 of 11 records: immature stage'))
  assert.ok(label.includes('3 of 11 records: adult collected from'))
  assert.ok(!label.includes('vague relationships'))
  // The visible dot is green alone, but the name and the popover still carry
  // the amber share -- the simplification is in the picture, not in the data.
  assert.deepEqual(state.rowMarkLines(group({ confirmed: 8, weak: 3 })).map(mark => mark.key),
    ['confirmed', 'weak'])
})
