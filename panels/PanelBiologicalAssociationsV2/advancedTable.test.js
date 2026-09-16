import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'
import * as vue from 'vue'

// AdvancedAssociationsTable owns the Advanced view's page number and its
// metadata loading, but panelBehavior.test.js replaces every .vue import with
// {} — so none of that was covered, and the panel could ship with pagination
// and citations dead while the suite stayed green. This file runs the real
// <script setup> of the child the same way, with a fake HTTP boundary.
const filename = new URL('./AdvancedAssociationsTable.vue', import.meta.url)
const { descriptor } = parse(readFileSync(filename, 'utf8'))
const compiled = compileScript(descriptor, { id: 'advanced-table-test', genDefaultAs: 'component' })
const body = compiled.content.replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '')

const defaults = {
  rows: [],
  taxa: { otuById: new Map(), dwcBySpecimen: new Map() },
  classification: new Map(),
  scope: 'animals:species',
  toolbar: null,
  rowsToolbar: null,
  active: true,
  loadImages: async () => new Map(),
  sourceCache: new Map()
}

/** `count` records sorted apart by their species epithet, with one record in
 * the middle of page 3 that is the only one of its relationship. */
function manyRows(count, oddOneOut = 110) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    relationship: index === oddOneOut ? 'pollinates' : 'feeds on',
    subject_otu_id: 11,
    object_otu_id: 22,
    subject: { type: 'Otu', id: 11, family: 'Curculionidae', label: `Hypera species${String(index).padStart(3, '0')}` },
    object: { type: 'Otu', id: 22, family: 'Apiaceae', label: 'Apium nodiflorum' }
  }))
}

function emptyPage() {
  return { data: [], headers: {} }
}

/** Let the setup's async metadata work run to completion. */
async function settle() {
  for (let i = 0; i < 6; i++) await new Promise(resolve => setTimeout(resolve, 0))
}

async function createTable(t, api, overrides = {}) {
  const mounted = []
  const emits = []
  const imports = {}
  for (const [local, binding] of Object.entries(compiled.imports)) {
    if (binding.source === 'vue') {
      imports[local] = binding.imported === 'onMounted' ? fn => mounted.push(fn)
        : binding.imported === 'onBeforeUnmount' ? () => {}
          : vue[binding.imported]
    } else if (binding.source === '@/utils') {
      imports[local] = binding.imported === 'makeAPIRequest' ? api : value => value
    } else if (binding.source.endsWith('.vue')) {
      imports[local] = {}
    } else {
      imports[local] = (await import(new URL(binding.source, filename)))[binding.imported]
    }
  }
  const component = new Function(...Object.keys(imports), body + '\nreturn component')(...Object.values(imports))
  const props = vue.reactive({ ...defaults, ...overrides })
  const scope = vue.effectScope()
  t.after(() => scope.stop())
  const state = scope.run(() => component.setup(props, {
    expose() {},
    emit: (...args) => emits.push(args)
  }))
  return { state, props, emits, mounted }
}

test('the default columns fetch citations in one batch for every record', async t => {
  const calls = []
  const { state } = await createTable(t, {
    get: async url => { calls.push(String(url)); return emptyPage() }
  }, { rows: [{ id: 1 }, { id: 2 }] })

  // Citations is a non-optional column, so it is visible from the start.
  assert.ok(state.settings.value.columns.includes('citations'))
  assert.ok(state.needed.value.includes('citations'),
    'the Citations column must map to the citations metadata kind')

  await settle()
  const citations = calls.filter(url => url.startsWith('/citations'))
  assert.equal(citations.length, 1, 'one batched request, not one per row')
  assert.match(citations[0], /citation_object_type=BiologicalAssociation/)
  assert.match(citations[0], /citation_object_id%5B%5D=1/)
  assert.match(citations[0], /citation_object_id%5B%5D=2/)
})

test('metadata loading actually starts when the view becomes active', async t => {
  const calls = []
  const { state, props } = await createTable(t, {
    get: async url => { calls.push(String(url)); return emptyPage() }
  }, { rows: [{ id: 1 }], active: false })

  await settle()
  assert.equal(calls.length, 0, 'an inactive table must not fetch')

  // Regression guard: the watcher must not hand its value array to
  // ensureMetadata's `generation` parameter, which would fail the generation
  // check and silently skip every metadata request.
  props.active = true
  await vue.nextTick()
  await settle()
  assert.ok(calls.some(url => url.startsWith('/citations')),
    'activating the view must trigger the metadata load')
  assert.equal(state.error.value, '')
})

test('turning a page shows the next records and asks nobody for them', async t => {
  const calls = []
  const { state, emits } = await createTable(t, {
    get: async url => { calls.push(String(url)); return emptyPage() }
  }, { rows: manyRows(120) })
  await settle()
  const before = calls.length

  assert.equal(state.visibleRows.value.length, 50)
  assert.equal(state.visibleRows.value[0].subject.species, 'species000')

  state.page.value = 3
  await vue.nextTick()

  // Every record of the taxon is already here, so a page is a slice -- not a
  // request, and not a wait before the selection is visible.
  assert.equal(state.visibleRows.value[0].subject.species, 'species100')
  assert.equal(state.visibleRows.value.length, 20)
  assert.equal(calls.length, before, 'turning a page must not fetch anything')
  assert.deepEqual(emits.filter(([event]) => event !== 'count'), [])
})

test('a filter reaches records that are not on the visible page', async t => {
  const { state } = await createTable(t, { get: async () => emptyPage() }, { rows: manyRows(120) })

  // The single 'pollinates' record sits on page 3. Filtering used to see only
  // the 50 rows the server had sent, so it could not be found at all.
  assert.ok(state.optionsFor('relationship').some(option => option.value === 'pollinates'),
    'the filter menu must offer values of records that are not on screen')

  state.setFilter('relationship', ['pollinates'])
  await vue.nextTick()
  assert.equal(state.filteredRows.value.length, 1)
  assert.deepEqual(state.visibleRows.value.map(row => row.id), [111])
})

test('sorting orders every record, not just the visible page', async t => {
  const { state } = await createTable(t, { get: async () => emptyPage() }, { rows: manyRows(120) })

  state.sortBy('subject.species')
  state.sortBy('subject.species')
  await vue.nextTick()

  // Descending over all 120 records puts the last one first. Sorting one page
  // in isolation would leave 'species049' at the top.
  assert.equal(state.settings.value.sort.direction, 'desc')
  assert.equal(state.visibleRows.value[0].subject.species, 'species119')
})

test('a filter starts at the top of its result, a column change leaves the reader put', async t => {
  const { state } = await createTable(t, { get: async () => emptyPage() }, { rows: manyRows(120) })

  state.page.value = 3
  await vue.nextTick()

  // Showing another column does not change which records match, so moving the
  // reader would be gratuitous.
  state.setColumns(['subject.genus', 'subject.species', 'relationship', 'object.genus', 'object.species', 'citations'])
  await vue.nextTick()
  assert.equal(state.page.value, 3)

  // A filter does change the result, and its first hit is what the reader
  // asked to see.
  state.setFilter('relationship', ['feeds on'])
  await vue.nextTick()
  assert.equal(state.page.value, 1)
})

test('a new page size keeps the first visible record in view', async t => {
  const { state } = await createTable(t, { get: async () => emptyPage() }, { rows: manyRows(120) })

  state.page.value = 3
  await vue.nextTick()
  assert.equal(state.visibleRows.value[0].subject.species, 'species100')

  state.updateSettings({ per: 100 })
  await vue.nextTick()
  assert.equal(state.page.value, 2, 'record 101 is on page 2 when a page holds 100')
  assert.equal(state.visibleRows.value[0].subject.species, 'species100')

  // The last page of a shorter list must stay a page that exists.
  state.updateSettings({ per: 50 })
  await vue.nextTick()
  assert.ok(state.page.value <= state.pageCount.value)
})

test('a new page size re-slices the records already in hand', async t => {
  const calls = []
  const { state, emits } = await createTable(t, {
    get: async url => { calls.push(String(url)); return emptyPage() }
  }, { rows: manyRows(120) })
  await settle()
  const before = calls.length

  state.updateSettings({ per: 100 })
  await vue.nextTick()

  assert.equal(state.visibleRows.value.length, 100)
  assert.equal(state.pageCount.value, 2)
  assert.equal(state.page.value, 1)
  assert.equal(calls.length, before, '50 to 100 must not reload the panel')
  assert.deepEqual(emits.filter(([event]) => event === 'page-size-change'), [])
})

test('the count line names the records and the page, and no row range', async t => {
  const { state } = await createTable(t, { get: async () => emptyPage() }, { rows: manyRows(120) })

  assert.equal(state.countLabel.value, '120 of 120 records · page 1 of 3')
  state.page.value = 3
  await vue.nextTick()
  assert.equal(state.countLabel.value, '120 of 120 records · page 3 of 3')

  // Nothing to page through: the page half of the line would only be noise.
  state.setFilter('relationship', ['no such relationship'])
  await vue.nextTick()
  assert.equal(state.countLabel.value, '0 of 120 records')
})

test('a vertical rule separates the column groups, never Family from Genus', async t => {
  const { state } = await createTable(t, { get: async () => emptyPage() }, { rows: manyRows(1) })

  assert.deepEqual(state.columns.value.filter(column => column.separator).map(column => column.key),
    ['relationship', 'object.family', 'citations'])
})

test('two triggers in the same tick fetch each metadata kind once', async t => {
  const calls = []
  const { props } = await createTable(t, {
    get: async url => { calls.push(String(url)); return emptyPage() }
  }, { rows: [{ id: 1 }] })

  await settle()
  calls.length = 0

  // A page change fires the synchronous rows watcher and the `needed` watcher
  // in the same tick. The in-flight guard used to be checked before awaiting
  // loadTaxa but set only afterwards, so both got through and every metadata
  // kind was fetched twice per page change.
  props.rows = [{ id: 2 }]
  await vue.nextTick()
  await settle()
  assert.equal(calls.filter(url => url.startsWith('/citations')).length, 1)
})

test('the name and authorship switches read the classification the panel supplies', async t => {
  // These two are the only places that rebuild rows outside `displayRows`, and
  // they were the last readers of the table's own classification state. Nothing
  // covered them, so the move to a panel-supplied prop broke both silently.
  const taxonName = { id: 111, cached: 'Hypera adspersa', cached_author_year: '(Fabricius, 1792)' }
  const accepted = { id: 112, cached: 'Hypera conmaculata', cached_author_year: '(Herbst, 1795)' }
  const rows = [
    { id: 1, relationship: 'feeds on', subject_otu_id: 11, object_otu_id: 22,
      subject: { type: 'Otu', id: 11, family: null, label: 'Hypera adspersa' },
      object: { type: 'Otu', id: 22, family: 'Apiaceae', label: 'Apium nodiflorum' } },
    { id: 2, relationship: 'feeds on', subject_otu_id: 33, object_otu_id: 22,
      subject: { type: 'Otu', id: 33, family: null, label: 'Apion frumentarium' },
      object: { type: 'Otu', id: 22, family: 'Apiaceae', label: 'Apium nodiflorum' } }
  ]
  const taxa = { dwcBySpecimen: new Map(), otuById: new Map([
    ['11', { id: 11, taxon_name_id: 111, taxon_name: taxonName, accepted_taxon_name: accepted, accepted_otu_id: 12 }],
    ['22', { id: 22, taxon_name_id: 221, taxon_name: { id: 221, cached: 'Apium nodiflorum' } }],
    ['33', { id: 33, taxon_name_id: 331, taxon_name: { id: 331, cached: 'Apion frumentarium' } }]
  ]) }
  const classification = new Map([
    ['111', { family: 'Curculionidae' }], ['112', { family: 'Curculionidae' }], ['331', { family: 'Brentidae' }]
  ])
  const { state } = await createTable(t, { get: async () => emptyPage() }, { rows, taxa, classification })

  const subject = () => state.displayRows.value[0].subject
  // The index left this row without a family; only the panel's walk has it.
  assert.equal(subject().family, 'Curculionidae')
  assert.deepEqual(subject().speciesNames.map(name => name.name), ['conmaculata'])

  // An active name filter is carried across the switch by rebuilding the rows
  // once more -- with the same classification, or the filter translates to a
  // family that does not exist and hides the row it was meant to keep.
  state.setFilter('subject.family', ['Curculionidae'])
  await vue.nextTick()
  assert.equal(state.filteredRows.value.length, 1)

  state.toggleOriginal('subject')
  await vue.nextTick()
  assert.deepEqual(subject().speciesNames.map(name => name.name), ['Hypera adspersa', 'Hypera conmaculata'])
  assert.equal(subject().family, 'Curculionidae', 'the family survives the switch')
  assert.deepEqual(state.settings.value.filters['subject.family'], ['Curculionidae'])
  assert.equal(state.filteredRows.value.length, 1, 'the row the filter selected must not disappear')

  state.toggleAuthorship()
  await vue.nextTick()
  assert.deepEqual(subject().speciesNames.map(name => name.authorship), ['(Fabricius, 1792)', '(Herbst, 1795)'])
})
