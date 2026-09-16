import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { compileScript, parse } from '@vue/compiler-sfc'
import * as vue from 'vue'
import { popoverPosition } from './useAnchoredPopover.js'
import { STANDARD_SUMMARY_PAGE_SIZE } from './loadStandardAssociations.js'

// Execute the actual Vue setup with a fake HTTP boundary. This covers view
// transitions and their async requests, which pure row-helper tests cannot.
const filename = new URL('./PanelBiologicalAssociationsV2.vue', import.meta.url)
const { descriptor } = parse(readFileSync(filename, 'utf8'))
const compiled = compileScript(descriptor, { id: 'panel-test', genDefaultAs: 'component' })
const body = compiled.content.replace(/^import[\s\S]*?from ['"][^'"]+['"]\s*$/gm, '')
const defaults = {
  otuId: 1, taxonId: 10, otu: {}, taxon: { rank_string: 'SpeciesGroup' },
  per: 50, collapseAboveRank: 'SpeciesGroup', collapseThreshold: 15
}

function emptyResponse() {
  return { data: [], headers: {
    'pagination-page': '1', 'pagination-per-page': '50', 'pagination-total': '0'
  } }
}

async function createPanel(t, api, overrides = {}) {
  const imports = {}
  for (const [local, binding] of Object.entries(compiled.imports)) {
    if (binding.source === 'vue') {
      imports[local] = ['onMounted', 'onBeforeUnmount'].includes(binding.imported)
        ? () => {} : vue[binding.imported]
    } else if (binding.source === '@/utils') {
      imports[local] = binding.imported === 'makeAPIRequest' ? api : value => value
    } else if (binding.source.endsWith('useOtuPageRequest.js')) {
      imports[local] = (_key, request) => request()
    } else if (binding.source.endsWith('/constants')) {
      imports[local] = {
        HIGHER_CLASSIFICATION_GROUP: 'HigherClassificationGroup', FAMILY_GROUP: 'FamilyGroup',
        GENUS_GROUP: 'GenusGroup', SPECIES_GROUP: 'SpeciesGroup',
        SPECIES_AND_INFRASPECIES_GROUP: 'SpeciesAndInfraspeciesGroup'
      }[binding.imported]
    } else if (binding.source.endsWith('.vue')) {
      imports[local] = {}
    } else {
      imports[local] = (await import(new URL(binding.source, filename)))[binding.imported]
    }
  }
  const component = new Function(...Object.keys(imports), body + '\nreturn component')(...Object.values(imports))
  const scope = vue.effectScope()
  t.after(() => scope.stop())
  return scope.run(() => component.setup({ ...defaults, ...overrides }, { expose() {} }))
}

test('Standard button leaves a Records drilldown; returning to Expert queries the whole taxon', async t => {
  const calls = []
  const state = await createPanel(t, { get: async url => { calls.push(url); return emptyResponse() } })
  state.summaryLoaded.value = true
  state.standardReady.value = true
  state.viewMode.value = 'expert'
  state.selectedGroup.value = { key: 'Old group', ids: [99], fromStandard: true }
  state.pagination.value.page = 3
  await state.setViewMode('standard')
  assert.equal(state.selectedGroup.value, null)
  await state.setViewMode('expert')
  const query = new URLSearchParams(calls.find(url => url.startsWith('/biological_associations?')).split('?')[1])
  assert.equal(query.has('biological_association_id[]'), false)
  assert.equal(query.get('otu_query[taxon_name_id][]'), '10')
  assert.equal(state.pagination.value.page, 1)
})

test('reducing the Expert relationship filter rechecks the summary threshold', async t => {
  const state = await createPanel(t, { get: async () => emptyResponse() })
  state.summaryLoaded.value = true
  state.viewMode.value = 'expert'
  state.forcedSummary.value = true
  await state.setSelectedRelationships([])
  assert.equal(state.showSummary.value, false)
  assert.equal(state.pagination.value.total, 0)
})

test('a slow Expert response cannot replace Standard after a mode change', async t => {
  let resolve
  const state = await createPanel(t, { get: () => new Promise(done => { resolve = done }) })
  state.summaryLoaded.value = true
  state.standardReady.value = true
  const pending = state.setViewMode('expert')
  await state.setViewMode('standard')
  resolve({ data: [{ id: 99 }], headers: { 'pagination-total': '1' } })
  await pending
  assert.equal(state.viewMode.value, 'standard')
  assert.equal(state.biologicalAssociations.value.length, 0)
  assert.equal(state.isLoading.value, false)
})

test('Advanced reads the whole taxon from the Basic index and caches view switches', async t => {
  const calls = []
  const state = await createPanel(t, { get: async (url, options) => { calls.push({ url, options }); return emptyResponse() } })
  state.summaryLoaded.value = true
  state.standardReady.value = true
  await state.setViewMode('advanced')
  assert.equal(state.advancedReady.value, true)
  assert.equal(state.advancedLoadState.value, 'ready')
  assert.deepEqual(state.advancedRows.value, [])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, '/biological_associations/basic')
  assert.equal(calls[0].options.params['otu_query[coordinatify]'], true)
  assert.equal(calls[0].options.params['otu_query[otu_id][]'], 1)
  assert.deepEqual(calls[0].options.params.extend, [
    'object', 'subject', 'biological_relationship', 'taxonomy', 'biological_relationship_types'
  ])
  await state.setViewMode('standard')
  await state.setViewMode('advanced')
  assert.equal(calls.length, 1)
})

test('Advanced uses the TaxonName descendant Basic scope above species rank', async t => {
  const calls = []
  const state = await createPanel(t, { get: async (url, options) => {
    calls.push({ url, options })
    return emptyResponse()
  } }, { taxon: { rank_string: 'TribeGroup' } })
  state.viewMode.value = 'advanced'
  await state.loadAdvancedRows()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].options.params['otu_query[coordinatify]'], true)
  assert.equal(calls[0].options.params['otu_query[taxon_name_id][]'], 10)
  assert.equal(calls[0].options.params['otu_query[descendants]'], true)
  assert.equal(calls[0].options.params['otu_query[otu_id][]'], undefined)
})

test('Advanced publishes non-empty Basic rows', async t => {
  const row = { id: 7, subject_otu_id: 1, object_otu_id: 2, relationship: 'feeds on',
    subject: { type: 'Otu', id: 1, family: 'Curculionidae', label: 'Hypera arator' },
    object: { type: 'Otu', id: 2, family: 'Apiaceae', label: 'Apium nodiflorum' } }
  const state = await createPanel(t, { get: async () => ({ data: [row], headers: {
    'pagination-page': '1', 'pagination-per-page': '50', 'pagination-total': '1', 'pagination-total-pages': '1'
  } }) })
  state.viewMode.value = 'advanced'
  await state.loadAdvancedRows()
  assert.equal(state.advancedLoadState.value, 'ready')
  assert.equal(state.advancedReady.value, true)
  assert.deepEqual(state.advancedRows.value, [row])
})

test('Advanced resolves missing FO/CO families in one batched ancestor walk', async t => {
  const row = { id: 7, subject_otu_id: 11, object_otu_id: 22, relationship: 'collected from',
    subject: { type: 'FieldOccurrence', id: 5000, family: null, label: 'FieldOccurrence 5000; record' },
    object: { type: 'AnatomicalPart', id: 6000, family: null, label: 'leaf: Dianthus carthusianorum' } }
  const taxonFor = (id, cached, parent_id) => ({ id, cached, rank: 'species', parent_id })
  const calls = []
  const state = await createPanel(t, { get: async (url, options = {}) => {
    calls.push({ url, options })
    const path = String(url).split('?')[0]
    if (path === '/biological_associations/basic') return {
      data: [row], headers: { 'pagination-page': '1', 'pagination-per-page': '3000', 'pagination-total': '1' }
    }
    if (path === '/otus') return {
      data: [
        { id: 11, taxon_name_id: 111, taxon_name: taxonFor(111, 'Hypera arator', 50) },
        { id: 22, taxon_name_id: 222, taxon_name: taxonFor(222, 'Dianthus carthusianorum', 60) }
      ], headers: { 'pagination-total': '2' }
    }
    if (path === '/taxon_names') return {
      data: [{ id: 50, name: 'Curculionidae', rank: 'family' }, { id: 60, name: 'Caryophyllaceae', rank: 'family' }],
      headers: { 'pagination-total': '2' }
    }
    return { data: [], headers: { 'pagination-total': '0' } }
  } })
  state.viewMode.value = 'advanced'
  await state.loadAdvancedRows()

  assert.equal(state.advancedLoadState.value, 'ready')
  // Families now come from the same batched parent walk that feeds Subfamily
  // and Tribe: one /taxon_names request for both names instead of one
  // /taxon_names/:id per name, which a whole-taxon load cannot afford.
  assert.equal(state.advancedClassification.value.get('111').family, 'Curculionidae')
  assert.equal(state.advancedClassification.value.get('222').family, 'Caryophyllaceae')
  assert.ok(calls.some(call => String(call.url).startsWith('/otus?')))
  assert.equal(calls.filter(call => /^\/taxon_names\//.test(String(call.url))).length, 0,
    'no per-name ancestry lookup may remain on the Advanced path')
  assert.equal(calls.filter(call => String(call.url).startsWith('/taxon_names?')).length, 1)
})

test('Advanced copies an index family across records of the same OTU', async t => {
  // /basic is not consistent about `family`: the same OTU can carry one on one
  // record and none on the next. An OTU without a TaxonName has no ancestry to
  // fall back on, so this pure pass is the only thing that can fill it.
  const rows = [
    { id: 1, subject_otu_id: 11, object_otu_id: 22, relationship: 'feeds on',
      subject: { type: 'Otu', id: 11, family: 'Curculionidae', label: 'Hypera postica' },
      object: { type: 'Otu', id: 22, family: 'Fabaceae', label: 'Vicia angustifolia' } },
    { id: 2, subject_otu_id: 11, object_otu_id: 22, relationship: 'feeds on',
      subject: { type: 'Otu', id: 11, family: 'Curculionidae', label: 'Hypera postica' },
      object: { type: 'AnatomicalPart', id: 99, family: null, label: 'leaf: Vicia angustifolia' } }
  ]
  const state = await createPanel(t, { get: async (url, options = {}) => {
    const path = String(url).split('?')[0]
    if (path === '/otus') return { data: [{ id: 11, taxon_name_id: 111, taxon_name: { id: 111, cached: 'Hypera postica' } }],
      headers: { 'pagination-total': '1' } }
    if (path === '/biological_associations/basic') return { data: rows, headers: {
      'pagination-page': String(options.params.page), 'pagination-per-page': '3000', 'pagination-total': '2' } }
    return { data: [], headers: { 'pagination-total': '0' } }
  } })
  state.viewMode.value = 'advanced'
  await state.loadAdvancedRows()

  assert.equal(state.advancedRows.value[1].object.family, 'Fabaceae')
  assert.equal(state.advancedRows.value[0].object.family, 'Fabaceae', 'a family already present is left alone')
})

test('selecting a higher-rank Raw group starts the detail request and publishes rows', async t => {
  const calls = []
  const basicRow = {
    id: 77, subject_otu_id: 11, object_otu_id: 22, relationship: 'reared from',
    subject: { type: 'Otu', id: 11, family: 'Curculionidae', label: 'Hypera arator' },
    object: { type: 'Otu', id: 22, family: 'Apiaceae', label: 'Apium nodiflorum' }
  }
  const fullRow = {
    id: 77,
    subject: { base_class: 'Otu', id: 11, object_tag: '<i>Hypera arator</i>' },
    object: { base_class: 'Otu', id: 22, object_tag: '<i>Apium nodiflorum</i>' },
    biological_relationship: { name: 'reared from' }
  }
  const response = (data, total = data.length) => ({ data, headers: {
    'pagination-page': '1', 'pagination-per-page': '50', 'pagination-total': String(total)
  } })
  const state = await createPanel(t, { get: async (url, options = {}) => {
    calls.push({ url, options })
    const path = url.split('?')[0]
    if (path === '/biological_associations') return response([fullRow])
    if (path === '/biological_associations/basic') return response([basicRow])
    if (path === '/otus') return response([
      { id: 11, taxon_name_id: 111, taxon_name: { id: 111, cached: 'Hypera arator' } },
      { id: 22, taxon_name_id: 222, taxon_name: { id: 222, cached: 'Apium nodiflorum' } }
    ])
    return response([])
  } })
  state.summaryLoaded.value = true
  state.standardReady.value = true
  state.viewMode.value = 'expert'
  state.selectedRelationships.value = ['reared from']

  await state.selectGroup({ key: 'Fabaceae', count: 1, ids: [77] })

  assert.equal(state.rawLoadState.value, 'ready')
  assert.equal(state.biologicalAssociations.value.length, 1)
  assert.ok(calls.some(call => call.url.startsWith('/biological_associations?')))
  assert.ok(calls.some(call => call.url.startsWith('/biological_associations/basic?')))
})

test('Raw group drilldown applies the selected relationship IDs before loading detail', async t => {
  const calls = []
  const rows = [
    { id: 77, subject_otu_id: 11, object_otu_id: 22, relationship: 'reared from',
      subject: { type: 'Otu', id: 11, family: 'Curculionidae', label: 'Hypera arator' },
      object: { type: 'Otu', id: 22, family: 'Apiaceae', label: 'Apium nodiflorum' } },
    { id: 78, subject_otu_id: 11, object_otu_id: 23, relationship: 'collected from',
      subject: { type: 'Otu', id: 11, family: 'Curculionidae', label: 'Hypera arator' },
      object: { type: 'Otu', id: 23, family: 'Apiaceae', label: 'Apium graveolens' } }
  ]
  const full = row => ({
    id: row.id,
    subject: { base_class: 'Otu', id: row.subject_otu_id, object_tag: '<i>Hypera arator</i>' },
    object: { base_class: 'Otu', id: row.object_otu_id, object_tag: `<i>${row.object.label}</i>` },
    biological_relationship: { name: row.relationship }
  })
  const response = (data, total = data.length) => ({ data, headers: {
    'pagination-page': '1', 'pagination-per-page': '50', 'pagination-total': String(total)
  } })
  const state = await createPanel(t, { get: async (url, options = {}) => {
    calls.push({ url, options })
    const path = url.split('?')[0]
    const query = new URLSearchParams(url.split('?')[1] || '')
    if (path === '/biological_relationships') {
      return response([{ id: 97, name: 'reared from' }, { id: 92, name: 'collected from' }], 2)
    }
    if (path === '/biological_associations' || path === '/biological_associations/basic') {
      const filtered = rows.filter(row => query.getAll('biological_association_id[]').includes(String(row.id)))
        .filter(row => !query.has('biological_relationship_id[]') || query.getAll('biological_relationship_id[]').includes(row.relationship === 'reared from' ? '97' : '92'))
      return response(path === '/biological_associations' ? filtered.map(full) : filtered)
    }
    if (path === '/otus') return response([
      { id: 11, taxon_name_id: 111, taxon_name: { id: 111, cached: 'Hypera arator' } },
      { id: 22, taxon_name_id: 222, taxon_name: { id: 222, cached: 'Apium nodiflorum' } }
    ])
    return response([])
  } })
  state.summaryLoaded.value = true
  state.standardReady.value = true
  state.summaryAsSubjectRows.value = rows
  state.viewMode.value = 'expert'
  state.selectedRelationships.value = ['reared from']

  await state.selectGroup({ key: 'Fabaceae', count: 1, ids: [77] })

  const detailCall = calls.find(call => call.url.startsWith('/biological_associations?'))
  assert.deepEqual(new URLSearchParams(detailCall.url.split('?')[1]).getAll('biological_relationship_id[]'), ['97'])
  assert.equal(state.biologicalAssociations.value.length, 1)
  assert.equal(state.biologicalAssociations.value[0].id, 77)
})

test('Advanced reads every index page and loads no OTU inventories', async t => {
  const calls = []
  const makeRow = id => ({ id, subject_otu_id: 11, object_otu_id: 22, relationship: 'feeds on',
    subject: { type: 'Otu', id: 11, family: 'Curculionidae', label: 'Hypera arator' },
    object: { type: 'Otu', id: 22, family: 'Apiaceae', label: 'Apium nodiflorum' } })
  const otus = [
    { id: 11, taxon_name_id: 111, taxon_name: { id: 111, cached: 'Hypera arator', cached_valid_taxon_name_id: 111 } },
    { id: 22, taxon_name_id: 222, taxon_name: { id: 222, cached: 'Apium nodiflorum', cached_valid_taxon_name_id: 222 } }
  ]
  const state = await createPanel(t, { get: async (url, options) => {
    calls.push({ url, options })
    if (String(url).startsWith('/otus')) {
      return { data: otus, headers: {
        'pagination-page': String(options.params.page),
        'pagination-per-page': String(options.params.per),
        'pagination-total': String(otus.length)
      } }
    }
    // A server that caps `per` below what was asked for still has to yield the
    // complete taxon -- filters and sorting are only as complete as this list.
    const page = options.params.page
    const data = Array.from({ length: page < 3 ? 50 : 1 }, (_, index) => makeRow((page - 1) * 50 + index + 1))
    return { data, headers: {
      'pagination-page': String(page), 'pagination-per-page': '50', 'pagination-total': '101'
    } }
  } })
  state.viewMode.value = 'advanced'
  await state.loadAdvancedRows()

  assert.equal(state.advancedRows.value.length, 101)
  const basic = calls.filter(call => call.url === '/biological_associations/basic')
  assert.equal(basic.length, 3, 'every index page is read before the view is published')
  assert.equal(basic[0].options.params['otu_query[otu_id][]'], 1)

  // The OTUs are fetched because the Advanced view shows the name in current
  // use, which only the OTU payload carries. The heavy per-OTU DwC inventories
  // remain a Standard-only cost.
  assert.equal(calls.filter(call => String(call.url).startsWith('/otus?')).length, 1)
  assert.equal(calls.some(call => /inventory/.test(String(call.url))), false)

  // Both names are valid, so no accepted-name lookup is made at all.
  assert.equal(calls.some(call => /taxon_name_id/.test(String(call.url))), false)
})

test('Advanced resolves a synonym OTU to the name in current use', async t => {
  // The Advanced view builds its names from the OTU payload, so an OTU filed
  // under an older name only shows "current names" -- and only offers the
  // "X now Y" reading -- once accepted_taxon_name/accepted_otu_id are present.
  const row = { id: 7, subject_otu_id: 11, object_otu_id: 22, relationship: 'feeds on',
    subject: { type: 'Otu', id: 11, family: 'Curculionidae', label: 'Hypera adspersa' },
    object: { type: 'Otu', id: 22, family: 'Apiaceae', label: 'Apium nodiflorum' } }
  const page = (data, options) => ({ data, headers: {
    'pagination-page': String(options.params?.page ?? 1),
    'pagination-per-page': String(options.params?.per ?? 50),
    'pagination-total': String(data.length)
  } })
  const state = await createPanel(t, { get: async (url, options) => {
    const text = String(url)
    if (text.startsWith('/otus?') && text.includes('taxon_name_id')) {
      return page([{ id: 12, taxon_name_id: 112, taxon_name: { id: 112, cached: 'Hypera conmaculata' } }], options)
    }
    if (text.startsWith('/otus?')) {
      return page([
        { id: 11, taxon_name_id: 111, taxon_name: { id: 111, cached: 'Hypera adspersa', cached_valid_taxon_name_id: 112 } },
        { id: 22, taxon_name_id: 221, taxon_name: { id: 221, cached: 'Apium nodiflorum', cached_valid_taxon_name_id: 221 } }
      ], options)
    }
    return { data: [row], headers: {
      'pagination-page': String(options.params.page), 'pagination-per-page': String(options.params.per),
      'pagination-total': '1'
    } }
  } })
  state.viewMode.value = 'advanced'
  await state.loadAdvancedRows()

  const subject = state.advancedTaxa.value.otuById.get('11')
  assert.equal(subject.accepted_taxon_name.cached, 'Hypera conmaculata')
  assert.equal(subject.accepted_otu_id, 12)
  assert.equal(subject.taxon_name.cached, 'Hypera adspersa', 'the original name is kept for the Original names switch')
  assert.equal(state.advancedTaxa.value.otuById.get('22').accepted_taxon_name, undefined)
})

test('returning to a loaded Advanced view does not raise the card-wide spinner', async t => {
  const busy = []
  const row = { id: 7, subject_otu_id: 11, object_otu_id: 22, relationship: 'feeds on',
    subject: { type: 'Otu', id: 11, family: 'Curculionidae', label: 'Hypera arator' },
    object: { type: 'Otu', id: 22, family: 'Apiaceae', label: 'Apium nodiflorum' } }
  const state = await createPanel(t, { get: async (url, options) => {
    busy.push(state.isLoading.value)
    if (String(url).startsWith('/otus')) {
      return { data: [], headers: { 'pagination-page': '1', 'pagination-per-page': '250', 'pagination-total': '0' } }
    }
    return { data: [row], headers: {
      'pagination-page': String(options.params.page), 'pagination-per-page': String(options.params.per),
      'pagination-total': '1'
    } }
  } })
  state.viewMode.value = 'advanced'

  // First build: nothing on screen yet, so the overlay is correct.
  await state.loadAdvancedRows()
  assert.equal(state.advancedReady.value, true)
  assert.ok(busy.includes(true), 'the first load may cover an empty card')

  // Coming back to a view that is already loaded costs nothing, and VSpinner
  // is an opaque overlay across the whole card -- it must not blank a table
  // that is showing rows.
  busy.length = 0
  state.standardReady.value = true
  state.standardLoadState.value = 'ready'
  await state.setViewMode('standard')
  await state.setViewMode('advanced')
  assert.equal(state.isLoading.value, false)
  assert.deepEqual(busy.filter(value => value === true), [])
  assert.equal(state.advancedLoadState.value, 'ready')

  // Retrying the warning line reloads with rows already on screen. That is the
  // one reload the overlay must sit out.
  busy.length = 0
  state.failedAdvancedMetadata.value = {}
  await state.retryAdvancedMetadata()
  assert.deepEqual([...new Set(busy)], [false], 'a retry must not cover the rows it is refreshing')
  assert.equal(state.advancedLoadState.value, 'ready')
})

test('Advanced exposes a retryable error for an invalid primary response', async t => {
  const state = await createPanel(t, { get: async () => ({ data: { id: 7 }, headers: {} }) })
  state.viewMode.value = 'advanced'
  await state.loadAdvancedRows()
  assert.equal(state.advancedLoadState.value, 'error')
  assert.equal(state.advancedReady.value, false)
  assert.match(state.loadError.value, /advanced view/i)
})

test('Advanced flags an empty page that reports records, but stays usable', async t => {
  const state = await createPanel(t, { get: async () => ({ data: [], headers: {
    'pagination-page': '1', 'pagination-per-page': '50', 'pagination-total': '1', 'pagination-total-pages': '1'
  } }) })
  state.viewMode.value = 'advanced'
  await state.loadAdvancedRows()
  // The inconsistency is reported next to a Retry instead of collapsing the
  // whole view — the reader keeps the pagination and can move on.
  assert.equal(state.advancedLoadState.value, 'ready')
  assert.equal(state.advancedReady.value, true)
  assert.equal(state.loadError.value, '')
  assert.match(state.advancedMetadataError.value, /empty page/i)
  assert.deepEqual(state.failedAdvancedMetadata.value, {})
})

test('Advanced retry resets only the failed primary cycle', async t => {
  let attempts = 0
  const state = await createPanel(t, { get: async () => {
    attempts++
    return attempts === 1 ? { data: { id: 7 }, headers: {} } : emptyResponse()
  } })
  state.standardReady.value = true
  state.viewMode.value = 'advanced'
  await state.loadAdvancedRows()
  assert.equal(state.advancedLoadState.value, 'error')
  await state.loadCurrentView()
  assert.equal(state.advancedLoadState.value, 'ready')
  assert.equal(state.advancedReady.value, true)
  assert.equal(state.standardReady.value, true)
})

test('Advanced taxonomy enrichment is limited to explicitly requested current-page OTUs', async t => {
  const calls = []
  const state = await createPanel(t, { get: async (url) => {
    calls.push(url)
    return { data: [{ id: 11, taxon_name_id: 111, taxon_name: { id: 111, cached: 'Current taxon' } }],
      headers: { 'pagination-total': '1' } }
  } })
  state.viewMode.value = 'advanced'
  const result = await state.loadAdvancedTaxa([11])
  assert.equal(result.otuById.get('11').taxon_name.cached, 'Current taxon')
  assert.deepEqual(calls.map(url => url.split('?')[0]), ['/otus'])
  assert.equal(calls.some(url => url.startsWith('/biological_associations')), false)
})

test('a slow Advanced OTU response cannot activate Advanced after returning to Standard', async t => {
  let resolve
  const state = await createPanel(t, { get: () => new Promise(done => { resolve = done }) })
  state.summaryLoaded.value = true
  state.standardReady.value = true
  state.summaryAsSubjectRows.value = [{ id: 1, subject_otu_id: 11, object_otu_id: 22,
    subject: { type: 'Otu', id: 11 }, object: { type: 'Otu', id: 22 } }]
  const pending = state.setViewMode('advanced')
  await vue.nextTick()
  await state.setViewMode('standard')
  resolve(emptyResponse())
  await pending
  assert.equal(state.advancedReady.value, false)
  assert.equal(state.viewMode.value, 'standard')
  assert.equal(state.isLoading.value, false)
})

test('higher-rank Standard publishes once after both complete Basic indices', async t => {
  const calls = []
  let release
  const laterPages = new Promise(resolve => { release = resolve })
  const page = (id, subject) => ({ id, subject_otu_id: subject ? 11 : 22,
    object_otu_id: subject ? 22 : 11, relationship: 'feeds on',
    subject: { type: 'Otu', id: subject ? 11 : 22, family: 'Currentidae', label: subject ? 'Current taxon' : 'Associated taxon' },
    object: { type: 'Otu', id: subject ? 22 : 11, family: 'Associatedidae', label: subject ? 'Associated taxon' : 'Current taxon' } })
  const api = { get: async (url, options = {}) => {
    calls.push(url)
    const [path, queryString = ''] = url.split('?')
    const query = new URLSearchParams(queryString)
    const params = options.params || {}
    if (path === '/biological_associations/basic') {
      if (String(params.page) === '1') {
        return { data: [page(params['subject_taxon_name_id[]'] !== undefined ? 1 : 2, params['subject_taxon_name_id[]'] !== undefined)],
          headers: { 'pagination-total': '2', 'pagination-total-pages': '2' } }
      }
      return laterPages
    }
    if (path === '/otus') {
      const ids = query.getAll('otu_id[]')
      return { data: ids.map(id => ({ id: Number(id), taxon_name_id: Number(id) * 10,
        taxon_name: { id: Number(id) * 10, cached: id === '11' ? 'Current taxon' : 'Associated taxon', rank: 'species' } })),
        headers: { 'pagination-total': String(ids.length) } }
    }
    return { data: [], headers: { 'pagination-total': '0' } }
  } }
  const state = await createPanel(t, api, { taxon: { rank_string: 'FamilyGroup' } })
  const loading = state.loadStandardView()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(state.standardReady.value, false)
  assert.deepEqual(state.summaryAsSubjectRows.value, [])
  assert.equal(state.standardLoadState.value, 'loading')
  release({ data: [page(3, true)], headers: { 'pagination-total': '2', 'pagination-total-pages': '2' } })
  await loading
  assert.equal(state.standardReady.value, true)
  assert.equal(state.standardIndexComplete.value, true)
  assert.equal(state.standardLoadState.value, 'ready')
  assert.equal(state.summaryAsSubjectRows.value.length, 2)
  assert.equal(state.summaryAsObjectRows.value.length, 2)
  assert.equal(calls.filter(url => url === '/biological_associations/basic').length, 4)
  assert.ok(calls.some(url => url.startsWith('/otus?')))
})

test('Standard leaves the table empty and exposes a retryable error for an invalid index response', async t => {
  const state = await createPanel(t, { get: async (url, options = {}) => {
    if (options.params?.['subject_taxon_name_id[]'] !== undefined) return { data: { id: 1 }, headers: {} }
    return { data: [], headers: { 'pagination-total': '0' } }
  } }, { taxon: { rank_string: 'FamilyGroup' } })
  await state.loadStandardView()
  assert.equal(state.standardLoadState.value, 'error')
  assert.equal(state.standardReady.value, false)
  assert.match(state.loadError.value, /standard view/i)
  assert.deepEqual(state.summaryAsSubjectRows.value, [])
})

test('Raw data clipboard labels append the specimen type rather than its info control', async t => {
  const state = await createPanel(t, { get: async () => emptyResponse() })
  assert.equal(state.rawParticipantCopyText({ subjectSpecimenType: 'FieldOccurrence',
    subjectSpeciesHtml: '<i>Hypera arator</i>', subjectLabelPrefix: 'Larvae of ' }, 'subject'),
  'Larvae of Hypera arator (FieldOccurrence)')
})

test('all views exclude unnamed OTUs before counts, summaries and Raw data pagination', async t => {
  const basic = [21, 22, 23].map((otuId, index) => ({ id: index + 1, subject_otu_id: 11, object_otu_id: otuId,
    relationship: 'reared from', subject: { type: 'Otu', id: 11, label: 'Hypera test', family: 'Curculionidae' },
    object: { type: index === 2 ? 'FieldOccurrence' : 'Otu', id: otuId, label: 'Plant test', family: 'Apiaceae' } }))
  const fullQueries = []
  const response = data => ({ data, headers: { 'pagination-page': '1', 'pagination-per-page': '1', 'pagination-total': String(data.length) } })
  const state = await createPanel(t, { get: async (url, config = {}) => {
    const [path, query] = url.split('?')
    const params = new URLSearchParams(query)
    if (path === '/otus') return response(params.getAll('otu_id[]').map(id => ({ id: Number(id),
      ...(id === '22' ? { name: 'unidentified plant' } : { taxon_name_id: Number(id) * 10,
        taxon_name: { id: Number(id) * 10, cached: id === '11' ? 'Hypera test' : 'Plant test' } }) })))
    if (path === '/biological_associations/basic') {
      // The directional reads carry the direction: this taxon is the subject.
      if (config.params?.['object_taxon_name_id[]']) return response([])
      const ids = params.getAll('biological_association_id[]')
      return response(ids.length ? basic.filter(row => ids.includes(String(row.id))) : basic)
    }
    if (path === '/biological_associations') {
      const ids = params.getAll('biological_association_id[]')
      fullQueries.push(ids)
      return response(basic.filter(row => ids.includes(String(row.id))).map(row => ({ id: row.id,
        subject: { base_class: 'Otu', id: 11, object_tag: '<i>Hypera test</i>' },
        object: { base_class: 'Otu', id: row.object_otu_id, object_tag: '<i>Plant test</i>' } })))
    }
    return response([])
  } })
  await state.loadStandardView()
  assert.equal(state.loadError.value, '')
  assert.deepEqual(state.allAssociationRows.value.map(row => row.id), [1, 3])
  assert.equal(state.hasExcludedAssociations.value, true)
  assert.equal(state.standardAsSubject.value.reduce((sum, group) => sum + group.count, 0), 2)
  state.viewMode.value = 'expert'
  state.pagination.value = { page: 2, per: 1, total: 0 }
  await state.loadBiologicalAssociations(2)
  assert.equal(state.loadError.value, '')
  assert.deepEqual(fullQueries, [['3']])
  assert.equal(state.pagination.value.total, 2)
  assert.equal(state.pagination.value.page, 2)
  assert.equal(state.biologicalAssociations.value.length, 1)
})

test('the higher-rank Raw summary takes its direction from the index, not from /otus', async t => {
  const calls = []
  const rows = Array.from({ length: 120 }, (_, index) => ({ id: index + 1, relationship: 'feeds on',
    subject_otu_id: 11, object_otu_id: 500 + index,
    subject: { type: 'Otu', id: 11, label: 'Hypera test', family: 'Curculionidae' },
    object: { type: 'Otu', id: 500 + index, label: 'Plant test',
      family: index % 2 ? 'Apiaceae' : 'Asteraceae' } }))
  const response = data => ({ data, headers: { 'pagination-page': '1',
    'pagination-per-page': String(data.length || 1), 'pagination-total': String(data.length) } })
  const state = await createPanel(t, { get: async (url, config = {}) => {
    const [path, query] = url.split('?')
    const search = new URLSearchParams(query)
    calls.push({ path, search, params: config.params || {} })
    if (path === '/biological_associations/basic') {
      return response(config.params?.['object_taxon_name_id[]'] ? [] : rows)
    }
    if (path === '/otus') {
      const ids = search.getAll('otu_id[]')
      return config.params?.['taxon_name_id[]']
        ? response(ids.filter(id => id === '11').map(id => ({ id: Number(id) })))
        : response(ids.map(id => ({ id: Number(id), taxon_name_id: Number(id) * 10,
          taxon_name: { id: Number(id) * 10 } })))
    }
    return response([])
  } }, { taxon: { rank_string: 'FamilyGroup' } })

  await state.loadSummary()

  assert.equal(state.loadError.value, '')
  assert.equal(state.summaryAsSubjectRows.value.length, 120)
  assert.equal(state.summaryAsObjectRows.value.length, 0)
  // Three index reads at the summary page size answer both the rows and their
  // direction. Asking /otus which participants are ours cost nine requests for
  // an answer the directional reads bring along, and a request without
  // `otu_id[]` would be the taxon's whole OTU inventory.
  const index = calls.filter(call => call.path === '/biological_associations/basic')
  assert.equal(index.length, 3)
  assert.ok(index.every(call => (call.search.get('per') || String(call.params.per))
    === String(STANDARD_SUMMARY_PAGE_SIZE)))
  assert.ok(calls.every(call => call.path !== '/otus' || call.search.getAll('otu_id[]').length))
  assert.equal(calls.filter(call => call.path === '/otus' && call.params['taxon_name_id[]']).length, 0)
})

test('a row the directional indices miss is placed by one bounded scope request', async t => {
  const calls = []
  // Row 3 belongs to the taxon through a specimen's determination, which no
  // taxon-name filter can see.
  const rows = [1, 2, 3].map(id => ({ id, relationship: 'collected from',
    subject_otu_id: id === 3 ? 77 : 11, object_otu_id: 500 + id,
    subject: { type: id === 3 ? 'CollectionObject' : 'Otu', id: id === 3 ? 900 : 11,
      label: 'Hypera test', family: 'Curculionidae' },
    object: { type: 'Otu', id: 500 + id, label: 'Plant test', family: 'Apiaceae' } }))
  const response = data => ({ data, headers: { 'pagination-page': '1',
    'pagination-per-page': String(data.length || 1), 'pagination-total': String(data.length) } })
  const state = await createPanel(t, { get: async (url, config = {}) => {
    const [path, query] = url.split('?')
    const search = new URLSearchParams(query)
    calls.push({ path, search, params: config.params || {} })
    if (path === '/biological_associations/basic') {
      if (config.params?.['object_taxon_name_id[]']) return response([])
      if (config.params?.['subject_taxon_name_id[]']) return response(rows.filter(row => row.id !== 3))
      return response(rows)
    }
    if (path === '/otus') {
      const ids = search.getAll('otu_id[]')
      return config.params?.['taxon_name_id[]']
        ? response(ids.filter(id => id === '77').map(id => ({ id: Number(id) })))
        : response(ids.map(id => ({ id: Number(id), taxon_name_id: Number(id) * 10,
          taxon_name: { id: Number(id) * 10 } })))
    }
    return response([])
  } }, { taxon: { rank_string: 'FamilyGroup' } })

  await state.loadSummary()

  assert.equal(state.loadError.value, '')
  assert.deepEqual(state.summaryAsSubjectRows.value.map(row => row.id), [1, 2, 3])
  assert.equal(state.summaryAsObjectRows.value.length, 0)
  const scope = calls.filter(call => call.path === '/otus' && call.params['taxon_name_id[]'])
  assert.equal(scope.length, 1)
  // The leftover row's own participants and this page's OTU as the anchor the
  // coordinate expansion needs -- not every participant of the index.
  assert.deepEqual(scope[0].search.getAll('otu_id[]').sort(), ['1', '503', '77'])
})

test('Expert citations consume every server page', async t => {
  const pages = []
  const state = await createPanel(t, { get: async (url, { params }) => {
    assert.ok(url.startsWith('/citations?'))
    pages.push(params.page)
    return { data: [{ id: params.page, citation_object_id: 7, citation_source_body: `Source ${params.page}` }],
      headers: { 'pagination-total': '2' } }
  } })
  const citations = await state.fetchCitations([7], 0)
  assert.deepEqual(pages, [1, 2])
  assert.equal(citations.get(7).length, 2)
})

test('Advanced opens the selected citation rather than combining all references of a record', async t => {
  const state = await createPanel(t, { get: async url => {
    assert.ok(url.startsWith('/citations?'))
    return { data: [
      { id: 1, citation_object_id: 7, citation_source_body: 'Dieckmann, 1989a', source: { cached: 'First reference' } },
      { id: 2, citation_object_id: 7, citation_source_body: 'Scherf, 1964', source: { cached: 'Second reference' } }
    ], headers: { 'pagination-total': '2' } }
  } })
  state.viewMode.value = 'advanced'
  await state.showAdvancedCitations({ associationId: 7, citationId: 2 })
  assert.equal(state.activeCitation.value.full, 'Second reference')
  assert.equal(state.activeCitation.value.short, 'Scherf, 1964')
})

test('Advanced shows the fetched reference even when the row carried no citation id', async t => {
  const state = await createPanel(t, { get: async () => ({ data: [
    { id: 1, citation_object_id: 7, citation_source_body: 'Dieckmann, 1989a', source: { cached: 'First reference' } }
  ], headers: { 'pagination-total': '1' } }) })
  state.viewMode.value = 'advanced'
  // The table's fallback button passes no id. A String(null) lookup used to
  // miss and fall through to the summary rows, which are empty in a session
  // that opened Advanced directly — leaving an empty modal.
  await state.showAdvancedCitations({ associationId: 7, citationId: null })
  assert.equal(state.activeCitation.value.full, 'First reference')
})

test('header popovers stay within narrow viewports and flip above near the bottom', () => {
  const viewport = { width: 320, height: 480 }
  const anchor = { left: 280, right: 300, top: 440, bottom: 460 }
  const box = { width: 288, height: 160 }
  for (const align of ['start', 'end']) {
    const position = popoverPosition(anchor, box, viewport, align)
    const left = parseFloat(position.left)
    const top = parseFloat(position.top)
    assert.ok(left >= 16 && left + box.width <= viewport.width - 16)
    assert.ok(top >= 16 && top + box.height < anchor.top)
  }
})
