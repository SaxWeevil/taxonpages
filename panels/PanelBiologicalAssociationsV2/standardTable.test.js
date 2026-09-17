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

test('every row renders all three slots in a fixed order', async t => {
  const state = await createTable(t)
  for (const counts of [{ confirmed: 3 }, { weak: 1 }, { excluded: 7 }, { confirmed: 2, excluded: 1 }]) {
    const marks = state.rowMarks(group(counts))
    assert.deepEqual(marks.map(mark => mark.key), ['confirmed', 'weak', 'excluded'],
      'a row with only one category must still reserve the other two columns')
    assert.deepEqual(marks.map(mark => mark.class),
      ['text-success', 'text-warning', 'text-danger'])
  }
})

test('a slot carries its own record count, zero when the category is absent', async t => {
  const state = await createTable(t)
  const marks = state.rowMarks(group({ confirmed: 8, weak: 3 }))
  assert.deepEqual(marks.map(mark => mark.count), [8, 3, 0])
  assert.equal(marks[0].title, '8 of 11 records: immature stage, or adult reared from or feeding observed in the wild')
  assert.equal(marks[1].title, '3 of 11 records: adult collected from')
})

test('a row without counts still reserves its three slots', async t => {
  const state = await createTable(t)
  const marks = state.rowMarks({ count: 0, name: 'X' })
  assert.deepEqual(marks.map(mark => mark.count), [0, 0, 0])
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

// The dots only stay in one column because every count reserves the same
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
