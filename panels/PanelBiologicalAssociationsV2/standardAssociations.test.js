import { test } from 'node:test'
import assert from 'node:assert/strict'
import { anatomicalPartName, makeStandardParticipant } from './makeBiologicalAssociation.js'
import {
  UNSPECIFIED_RELATIONSHIP,
  filterRowsByRelationships,
  genusSpeciesName,
  groupStandardAssociations,
  relationshipValue
} from './groupStandardAssociations.js'
import {
  enrichAssociationFamilies,
  fillAssociationFamilies,
  fetchAllAssociationPages,
  fetchRowsInBatches,
  loadDirectionalStandardSummary,
  loadOtuScopeMembership,
  loadSummaryIndexes,
  loadTaxonomicFamilies,
  loadStandardTaxa,
  missingFamilyTaxonNameIds,
  resolveAcceptedNames,
  splitAssociationsByDirection,
  unresolvedDirectionRows,
  validateAssociationPage
} from './loadStandardAssociations.js'
import {
  indexRelationshipIds,
  relationshipIdsForSelection,
  relationshipSelectedByDefault,
  selectedRelationshipsForOptions,
  updateRelationshipPreferences
} from './relationshipPreferences.js'

// Minimal real /basic shapes: type+label differ from full base_class+object_label.
const plant = { id: 1383723, type: 'Otu', family: 'Caryophyllaceae', label: 'Dianthus carthusianorum L.' }
const beetle = { id: 95, type: 'AnatomicalPart', family: 'Curculionidae', label: 'larvae: Hypera (Kippenbergia) arator (Linnaeus, 1758)' }
const part = (label, id = 96) => ({ ...plant, id, type: 'AnatomicalPart', label: label + ': Dianthus carthusianorum L.' })
const row = (id, object = plant, subject = beetle) => ({
  id, subject, object, subject_otu_id: 732584, object_otu_id: 1383723,
  relationship: 'feeding observed in the wild on'
})
const otuById = new Map([
  ['1383723', { id: 1383723, taxon_name_id: 1583501, taxon_name: { cached: 'Dianthus carthusianorum', cached_author_year: 'L.', rank: 'species' } }],
  ['732584', { id: 732584, taxon_name_id: 833810, taxon_name: { cached: 'Hypera (Kippenbergia) arator', cached_author_year: '(Linnaeus, 1758)', rank: 'species' } }],
  ['1411454', { id: 1411454, name: 'Hypera arator', taxon_name_id: 833810, taxon_name: { cached: 'Hypera (Kippenbergia) arator', cached_author_year: '(Linnaeus, 1758)', rank: 'species' } }]
])

test('standard view combines repeated species and sorts unique plant parts', () => {
  const rows = [row(1, part('plant ovary')), row(2, part('leaf')), row(3, part('leaf')), row(4)]
  const [group] = groupStandardAssociations(rows, 'subject', otuById)
  assert.equal(group.name, 'Dianthus carthusianorum')
  assert.equal(group.otuId, 1383723)
  assert.deepEqual(group.families, ['Caryophyllaceae'])
  // Row 4 names no organ, so it contributes no term at all.
  assert.deepEqual(group.parts, ['leaf', 'plant ovary'])
  assert.equal(group.count, 4)
})

test('a mixed group counts its records by evidence mark', () => {
  const adult = { id: 732584, type: 'Otu', family: 'Curculionidae', label: 'Hypera (Kippenbergia) arator (Linnaeus, 1758)' }
  const rows = [
    row(1),                                                         // larvae -> confirmed
    { ...row(2, plant, adult), relationship: 'collected from' },    // weak
    { ...row(3, plant, adult), relationship: '[legacy] feeds on' }  // excluded
  ]
  const [group] = groupStandardAssociations(rows, 'subject', otuById)
  assert.deepEqual(group.counts, { confirmed: 1, weak: 1, excluded: 1 })
  assert.equal(group.count, 3)
})

test('a group of one category carries only that count', () => {
  const [group] = groupStandardAssociations([row(1), row(2)], 'subject', otuById)
  assert.deepEqual(group.counts, { confirmed: 2, weak: 0, excluded: 0 })
})

test('beetle pages combine plant parts across life stages', () => {
  const egg = { ...beetle, id: 187, label: 'egg: Hypera arator' }
  const rows = [row(1, part('plant ovary')), row(2, part('leaf'), egg), row(3, part('flower'))]
  const [group] = groupStandardAssociations(rows, 'subject', otuById)
  assert.deepEqual(group.parts, ['flower', 'leaf', 'plant ovary'])
  assert.equal(group.count, 3)
})

test('plant pages show their plant parts before the compact associated beetle name', () => {
  const [group] = groupStandardAssociations(
    [row(1, part('leaf')), row(2, part('flower'))],
    'object',
    otuById
  )
  assert.equal(group.name, 'Hypera arator')
  assert.deepEqual(group.parts, ['flower', 'leaf'])
  assert.deepEqual(group.families, ['Curculionidae'])
})

test('a plant without an anatomical part carries no part in either direction', () => {
  // Every row of the Field Assistant is about a plant, so "on plant" told
  // nobody anything; the cell stays empty instead. Raw data keeps the term.
  const subjectPage = groupStandardAssociations([row(1)], 'subject', otuById)
  const objectPage = groupStandardAssociations([row(1)], 'object', otuById)

  assert.deepEqual(subjectPage[0].parts, [])
  assert.deepEqual(objectPage[0].parts, [])
})

test('standard names omit subgenus, authorship and year', () => {
  assert.equal(
    genusSpeciesName('Hypera (Eririnomorphus) conmaculata (Herbst, 1795)'),
    'Hypera conmaculata'
  )
  assert.equal(genusSpeciesName('Dianthus carthusianorum L.'), 'Dianthus carthusianorum')
  assert.equal(genusSpeciesName('Dianthus × hybrida'), 'Dianthus × hybrida')
  assert.equal(genusSpeciesName('Unidentified taxon'), 'Unidentified taxon')
})

test('FO-only associations resolve the underlying taxon without a direct OTU association', () => {
  const fo = { type: 'FieldOccurrence', id: 5000, label: 'FieldOccurrence 5000; uuid; Germany' }
  const data = { ...row(253118, plant, fo), subject_otu_id: 1411454 }
  const dwc = new Map([['FieldOccurrence:5000', { scientificName: 'Hypera arator (Linnaeus, 1758)', family: 'Curculionidae' }]])
  const [group] = groupStandardAssociations([data], 'object', otuById, dwc)
  assert.equal(group.name, 'Hypera arator')
  assert.equal(group.otuId, 1411454)
  assert.deepEqual(group.families, ['Curculionidae'])
})

test('different OTUs of the same TaxonName combine even across CO, FO and anatomical parts', () => {
  const fo = { type: 'FieldOccurrence', id: 5000, label: 'FieldOccurrence 5000; uuid' }
  const co = { type: 'CollectionObject', id: 5000, label: 'CollectionObject 5000; uuid' }
  const records = [
    row(1),
    { ...row(2, plant, fo), subject_otu_id: 1411454 },
    { ...row(3, plant, co), subject_otu_id: 1411454 }
  ]
  const [group] = groupStandardAssociations(records, 'object', otuById)
  assert.equal(group.count, 3)
  assert.deepEqual(group.parts, [])
})

test('family is shared between anatomical records of the same taxon', () => {
  const rows = [
    row(1, { ...part('leaf'), family: null }),
    row(2, plant, { ...beetle, label: 'egg: Hypera arator' })
  ]
  const [group] = groupStandardAssociations(rows, 'subject', otuById)
  assert.equal(group.families.join(), 'Caryophyllaceae')
})

test('Expert family gaps resolve through the same OTU or accepted TaxonName', () => {
  const familyRows = [
    row(1, { ...plant, family: 'Caryophyllaceae' }),
    row(2, plant, { ...beetle, family: 'Curculionidae' })
  ]
  const rows = [
    row(3, { ...part('plant ovary'), family: null }),
    {
      ...row(4, plant, { id: 5000, type: 'FieldOccurrence', family: null, label: 'FieldOccurrence 5000' }),
      subject_otu_id: 1411454
    }
  ]
  const filled = fillAssociationFamilies(rows, otuById, new Map(), familyRows)

  assert.equal(filled[0].object.family, 'Caryophyllaceae')
  assert.equal(filled[1].subject.family, 'Curculionidae')
  assert.deepEqual(missingFamilyTaxonNameIds(filled, otuById), [])
})

test('taxonomy ancestry supplies a family when no association row contains it', async () => {
  const calls = []
  const cache = await loadTaxonomicFamilies(['833810'], {
    get: async (url, { params }) => {
      calls.push({ url, params })
      if (url === '/taxon_names/833810') {
        return { data: {
          id: 833810,
          rank: 'species',
          ancestor_ids: [
            [833770, 'NomenclaturalRank::Iczn::GenusGroup::Genus'],
            [810196, 'NomenclaturalRank::Iczn::FamilyGroup::Family']
          ]
        } }
      }
      return {
        data: [{ id: 810196, cached: 'Curculionidae', rank: 'family' }],
        headers: { 'pagination-total': '1' }
      }
    }
  })

  assert.equal(cache.get('833810'), 'Curculionidae')
  assert.equal(calls[0].url, '/taxon_names/833810')
  assert.deepEqual(calls[0].params.extend, ['ancestor_ids'])
  assert.equal(new URLSearchParams(calls[1].url.split('?')[1]).get('taxon_name_id[]'), '810196')
})

test('unidentified CO and FO with equal numeric IDs remain separate and visible', () => {
  const rows = ['CollectionObject', 'FieldOccurrence'].map((type, i) => ({
    ...row(i + 1, { id: 5000, type, label: type + ' 5000' }),
    object_otu_id: null
  }))
  const groups = groupStandardAssociations(rows, 'subject')
  assert.equal(groups.length, 2)
  assert.ok(groups.every(g => !g.otuId && !g.italic))
})

test('anatomical parts wrapping specimens use specimen type+id and keep their organ', () => {
  const data = row(1, { type: 'AnatomicalPart', id: 99, label: 'nidus: FieldOccurrence 5000; uuid' })
  const dwc = new Map([
    ['CollectionObject:5000', { scientificName: 'Wrong species', family: 'Wrong family' }],
    ['FieldOccurrence:5000', { scientificName: 'Dianthus carthusianorum L.', family: 'Caryophyllaceae' }]
  ])
  const participant = makeStandardParticipant(data, 'object', new Map(), dwc)
  assert.equal(participant.name, 'Dianthus carthusianorum')
  assert.equal(participant.part, 'nidus')
  assert.equal(participant.family, 'Caryophyllaceae')
})

test('BiologicalProperty values do not masquerade as anatomical parts', () => {
  assert.equal(anatomicalPartName({ ...plant, properties: 'leaf | imago' }), null)
  assert.equal(anatomicalPartName({ ...beetle, properties: 'imago' }), 'larvae')
})

test('higher-rank descendants combine without including current-side taxa in grouping keys', () => {
  const anotherBeetle = { ...beetle, id: 300, label: 'larvae: Another beetle' }
  const groups = groupStandardAssociations([row(1), { ...row(2, plant, anotherBeetle), subject_otu_id: 999 }], 'subject', otuById)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].count, 2)
})

test('family and names sort alphabetically, blank families last, duplicate IDs count once', () => {
  const rows = [
    { ...row(1, { ...plant, id: 6, label: 'Zea mays', family: 'Poaceae' }), object_otu_id: 6 },
    { ...row(2), relationship: 'collected from' },
    row(3), row(3),
    { ...row(4, { ...plant, id: 7, label: 'Unknown plant', family: null }), object_otu_id: 7 }
  ]
  const groups = groupStandardAssociations(rows, 'subject', otuById)
  assert.deepEqual(groups.map(g => g.name), ['Dianthus carthusianorum', 'Zea mays', 'Unknown plant'])
  assert.equal(groups[0].count, 2)
})

test('standard rows sort by family and associated taxon', () => {
  const aster = (id, name) => ({ id, type: 'Otu', family: 'Asteraceae', label: name })
  const rows = [
    row(1, aster(10, 'Beta plant')),
    row(2, aster(9, 'Alpha plant')),
    row(3, aster(9, 'Alpha plant'), { ...beetle, label: 'egg: Hypera arator' }),
    row(4, { id: 11, type: 'Otu', family: 'Poaceae', label: 'A grass' })
  ].map(record => ({ ...record, object_otu_id: null }))
  const groups = groupStandardAssociations(rows, 'subject')
  assert.deepEqual(groups.map(group => [group.families[0], group.name]), [
    ['Asteraceae', 'Alpha plant'],
    ['Asteraceae', 'Beta plant'],
    ['Poaceae', 'A grass']
  ])
})

test('plant pages do not display associated animal life stages as anatomy', () => {
  const directSubject = { id: 732584, type: 'Otu', family: 'Curculionidae', label: 'Hypera arator' }
  const [group] = groupStandardAssociations([
    row(1, part('leaf'), directSubject),
    row(2, part('flower'))
  ], 'object', otuById)
  assert.deepEqual(group.parts, ['flower', 'leaf'])
})

test('display placeholders stay blank', () => {
  const unavailablePlant = {
    ...part('Not available'),
    family: 'Not specified'
  }
  const unspecifiedBeetle = {
    ...beetle,
    label: 'Not specified: Hypera arator'
  }
  const [normal] = groupStandardAssociations([
    row(1, unavailablePlant)
  ], 'subject')
  const [plantPage] = groupStandardAssociations([
    row(2, unavailablePlant, unspecifiedBeetle)
  ], 'object')

  assert.deepEqual(normal.families, [])
  assert.deepEqual(normal.parts, [])
  assert.deepEqual(plantPage.parts, [])
})

test('relationship filter shows exactly the selected values, including a labelled empty value', () => {
  const rows = [
    row(1),
    { ...row(2), relationship: 'collected from' },
    { ...row(3), relationship: '' }
  ]
  assert.equal(relationshipValue(rows[2]), UNSPECIFIED_RELATIONSHIP)
  assert.deepEqual(
    filterRowsByRelationships(rows, ['collected from']).map(record => record.id),
    [2]
  )
  assert.deepEqual(
    filterRowsByRelationships(rows, [UNSPECIFIED_RELATIONSHIP]).map(record => record.id),
    [3]
  )
  assert.deepEqual(filterRowsByRelationships(rows, []), [])
})

test('relationship defaults omit legacy and undefined relationships', () => {
  const options = [
    'feeding observed in the wild on',
    'Legacy feeding relationship',
    'undefined relationship with'
  ]
  assert.equal(relationshipSelectedByDefault(options[0]), true)
  assert.equal(relationshipSelectedByDefault(options[1]), false)
  assert.equal(relationshipSelectedByDefault(options[2]), false)
  assert.deepEqual(selectedRelationshipsForOptions(options), [options[0]])
})

test('Expert relationship names resolve to every matching API id', () => {
  const idsByName = indexRelationshipIds([
    { id: 95, name: 'feeding observed in the wild on' },
    { id: 192, name: 'feeding observed in the wild on' },
    { id: 92, name: 'collected from' },
    { id: null, name: 'ignored' }
  ])

  assert.deepEqual(
    relationshipIdsForSelection(
      ['collected from', 'feeding observed in the wild on', 'missing'],
      idsByName
    ),
    [92, 95, 192]
  )
})

test('manual relationship choices persist while unseen relationships retain defaults', () => {
  const firstOptions = ['feeding observed in the wild on', 'undefined relationship with']
  const preferences = updateRelationshipPreferences(
    firstOptions,
    ['undefined relationship with']
  )
  const nextOptions = [
    ...firstOptions,
    'collected from',
    'Legacy association'
  ]
  assert.deepEqual(selectedRelationshipsForOptions(nextOptions, preferences), [
    'undefined relationship with',
    'collected from'
  ])
})

test('family classification survives when its source row is hidden by relationship filter', () => {
  const classified = row(1, plant)
  const unclassified = {
    ...row(2, { ...plant, family: null }),
    relationship: 'collected from'
  }
  const groups = groupStandardAssociations(
    [unclassified], 'subject', otuById, new Map(), [classified, unclassified]
  )
  assert.deepEqual(groups[0].families, ['Caryophyllaceae'])
})

test('same-label OTUs with different taxonomic identities stay separate', () => {
  const otus = new Map(otuById)
  otus.set('9', { ...otus.get('1383723'), id: 9, taxon_name_id: 999 })
  const groups = groupStandardAssociations([row(1), { ...row(2), object_otu_id: 9 }], 'subject', otus)
  assert.equal(groups.length, 2)
})

test('reads all pages even when the server caps the requested page size', async () => {
  const calls = []
  const rows = await fetchAllAssociationPages(async (page, per) => {
    calls.push([page, per])
    return { data: [{ id: page }], headers: { 'pagination-total': '3', 'pagination-total-pages': '3', 'pagination-per-page': '1' } }
  })
  assert.equal(rows.length, 3)
  assert.deepEqual(calls.map(c => c[0]), [1, 2, 3])
})

test('supports X-Total pagination headers', async () => {
  const rows = await fetchAllAssociationPages(async page => ({
    data: [{ id: page }], headers: { 'x-total': '2', 'x-total-pages': '2' }
  }))
  assert.equal(rows.length, 2)
})

test('without pagination headers, reads until empty rather than silently truncating', async () => {
  const calls = []
  const rows = await fetchAllAssociationPages(async page => {
    calls.push(page)
    return { data: page <= 2 ? [{ id: page }] : [] }
  })
  assert.equal(rows.length, 2)
  assert.deepEqual(calls, [1, 2, 3])
})

test('repeated pages and incomplete final pages report an issue and keep what was read', async () => {
  const repeated = []
  const repeatedRows = await fetchAllAssociationPages(
    async () => ({ data: [{ id: 1 }] }), undefined, undefined, undefined, issue => repeated.push(issue)
  )
  assert.deepEqual(repeatedRows.map(row => row.id), [1])
  assert.match(repeated.join(' '), /repeated a page/)

  const incomplete = []
  const incompleteRows = await fetchAllAssociationPages(async () => ({
    data: [{ id: 1 }], headers: { 'pagination-total': '3', 'pagination-total-pages': '1' }
  }), undefined, undefined, undefined, issue => incomplete.push(issue))
  assert.deepEqual(incompleteRows.map(row => row.id), [1])
  assert.match(incomplete.join(' '), /ended before every reported record/)
})

test('a page that repeats a row keeps the record once instead of failing', () => {
  const result = validateAssociationPage({
    data: [{ id: 1 }, { id: 1 }, { id: 2 }], headers: {}
  })
  assert.deepEqual(result.data.map(row => row.id), [1, 2])
  assert.match(result.issues.join(' '), /repeated record/)
})

test('headers that contradict the payload are dropped, not fatal', () => {
  const smallTotal = validateAssociationPage({
    data: [{ id: 1 }, { id: 2 }], headers: { 'pagination-total': '1' }
  })
  assert.equal(smallTotal.total, null)
  assert.deepEqual(smallTotal.data.map(row => row.id), [1, 2])

  const inconsistent = validateAssociationPage({
    data: [{ id: 1 }],
    headers: { 'pagination-total': '10', 'pagination-per-page': '5', 'pagination-total-pages': '7' }
  })
  assert.equal(inconsistent.totalPages, null)
  assert.equal(inconsistent.total, 10)
  assert.match(inconsistent.issues.join(' '), /page count/)
})

test('a mis-attributed page and a row without an id still fail hard', () => {
  assert.throws(() => validateAssociationPage({
    data: [{ id: 1 }], headers: { 'pagination-page': '1' }
  }, 2), /Unexpected association page/)
  assert.throws(() => validateAssociationPage({ data: [{ id: null }], headers: {} }), /without an id/)
})

test('invalid pagination headers and IDs are rejected before publication', () => {
  assert.throws(() => validateAssociationPage({
    data: [], headers: { 'pagination-total': 'not-a-number' }
  }), /Invalid pagination header/)
  assert.throws(() => validateAssociationPage({
    data: [{ id: null }], headers: {}
  }), /without an id/)
})

test('stale navigation stops the page loop without publishing old results', async () => {
  let current = true
  let calls = 0
  const result = await fetchAllAssociationPages(async () => {
    calls++
    current = false
    return { data: [{ id: 1 }], headers: { 'pagination-total-pages': '5' } }
  }, () => current)
  assert.equal(result, null)
  assert.equal(calls, 1)
})

test('directional Standard summary collects both complete indices before returning', async () => {
  const calls = []
  const result = await loadDirectionalStandardSummary(42, {
    get: async (url, { params }) => {
      calls.push({ url, params })
      const subject = params['subject_taxon_name_id[]'] !== undefined
      const id = subject ? 10 : 20
      return {
        data: params.page === 1 ? [{ id }] : [{ id: id + 1 }],
        headers: { 'pagination-page': String(params.page), 'pagination-per-page': '1',
          'pagination-total': '2', 'pagination-total-pages': '2' }
      }
    }
  }, () => true, 1)
  assert.deepEqual(result.asSubject.map(row => row.id), [10, 11])
  assert.deepEqual(result.asObject.map(row => row.id), [20, 21])
  assert.equal(calls.length, 4)
  assert.deepEqual(calls.map(call => call.params.page), [1, 1, 2, 2])
})

test('directional Standard summary does not publish a partial result after stale navigation', async () => {
  let current = true
  const result = await loadDirectionalStandardSummary(42, {
    get: async () => {
      current = false
      return { data: [{ id: 1 }], headers: { 'pagination-total': '2', 'pagination-total-pages': '2' } }
    }
  }, () => current, 1)
  assert.equal(result, null)
})

test('OTU scope membership asks TaxonWorks only about the participants it was given', async () => {
  const calls = []
  const ids = Array.from({ length: 250 }, (_, index) => String(700 + index))
  const scope = await loadOtuScopeMembership(ids, 833780, {
    get: async (url, { params }) => {
      const batch = new URLSearchParams(url.split('?')[1]).getAll('otu_id[]')
      calls.push({ url, params, batch })
      // The last, short batch holds nothing of this taxon at all.
      if (batch.includes('900')) return { data: [], headers: { 'pagination-total-pages': '0' } }
      const inScope = batch.filter((id, index) => index % 50 === 0)
      // TaxonWorks returns the coordinates of a match as well, including OTUs
      // nobody asked about, and it spreads them over the pages it chooses.
      const page = params.page === 1 ? [...inScope.slice(0, 1), '999999'] : inScope.slice(1)
      return { data: page.map(id => ({ id: Number(id) })), headers: { 'pagination-total-pages': '2' } }
    }
  })

  // Only requested ids, in the order they were given -- an unrequested
  // coordinate answers a question that was never asked.
  assert.deepEqual([...scope], ['700', '750', '800', '850'])
  // Two batches of 100 read both their pages, the third answers in one.
  assert.equal(calls.length, 5)
  assert.deepEqual([...new Set(calls.map(call => call.batch.length))].sort((a, b) => a - b), [50, 100])
  assert.deepEqual([...new Set(calls.flatMap(call => call.batch))].sort(), [...ids].sort())
  assert.ok(calls.every(call => call.url.split('?')[0] === '/otus' && call.batch.length))
  assert.ok(calls.every(call => call.params['taxon_name_id[]'] === 833780
    && call.params.descendants === true && call.params.coordinatify === true))
})

test('OTU scope membership anchors the coordinate expansion without answering for the anchor', async () => {
  const calls = []
  const scope = await loadOtuScopeMembership(['1371003'], 833646, {
    get: async url => {
      const asked = new URLSearchParams(url.split('?')[1]).getAll('otu_id[]')
      calls.push(asked)
      // TaxonWorks applies otu_id[] first and coordinatifies what survives, so
      // the synonym's OTU comes back only because the anchor matched.
      return {
        data: asked.includes('732420') ? [{ id: 732420 }, { id: 1371003 }, { id: 1371008 }] : [],
        headers: { 'pagination-total-pages': '1' }
      }
    }
  }, () => true, ['732420'])

  assert.deepEqual(calls, [['1371003', '732420']])
  // The anchor was never in question, and neither was the coordinate beside it.
  assert.deepEqual([...scope], ['1371003'])
})

test('an anchor already being asked about is not asked for twice', async () => {
  const calls = []
  const scope = await loadOtuScopeMembership(['7', '8'], 5, {
    get: async url => {
      calls.push(new URLSearchParams(url.split('?')[1]).getAll('otu_id[]'))
      return { data: [{ id: 7 }], headers: { 'pagination-total-pages': '1' } }
    }
  }, () => true, ['7'])

  assert.deepEqual(calls, [['7', '8']])
  assert.deepEqual([...scope], ['7'])
})

test('OTU scope membership makes no request when there is nothing to ask about', async () => {
  const scope = await loadOtuScopeMembership([], 833780, {
    get: async () => { throw new Error('should not be called') }
  })
  assert.equal(scope.size, 0)
})

test('summary indexes read the coordinatified query and both directions in one round', async () => {
  const calls = []
  const page = (data, pages) => ({ data, headers: { 'pagination-total-pages': String(pages) } })
  const indexes = await loadSummaryIndexes(814044, {
    get: async (url, config = {}) => {
      const [path, query] = url.split('?')
      const params = { ...Object.fromEntries(new URLSearchParams(query)), ...(config.params || {}) }
      calls.push({ path, params, page: Number(params.page), per: Number(params.per) })
      if (params['subject_taxon_name_id[]']) return page([{ id: 1 }], 1)
      if (params['object_taxon_name_id[]']) return page([{ id: 2 }], 1)
      // Only the coordinatified query knows the specimen-matched row, and it
      // puts it on a page of its own choosing.
      return page(Number(params.page) === 1 ? [{ id: 1 }, { id: 2 }] : [{ id: 3 }], 2)
    }
  }, () => true, 1000)

  assert.deepEqual(indexes.rows.map(row => row.id), [1, 2, 3])
  assert.deepEqual([...indexes.subjectIds], ['1'])
  assert.deepEqual([...indexes.objectIds], ['2'])
  // Three reads start together; the second page belongs to the query that
  // reported it. Direction costs no request of its own.
  assert.equal(calls.filter(call => call.page === 1).length, 3)
  assert.equal(calls.length, 4)
  assert.ok(calls.every(call => call.path === '/biological_associations/basic' && call.per === 1000))
  const coordinatified = calls.filter(call => call.params['otu_query[taxon_name_id][]'] === '814044')
  assert.deepEqual(coordinatified.map(call => call.page), [1, 2])
  assert.ok(coordinatified.every(call => call.params['otu_query[descendants]'] === 'true'
    && call.params['otu_query[coordinatify]'] === 'true'))
  const directional = calls.filter(call => call.params['subject_taxon_name_id[]']
    || call.params['object_taxon_name_id[]'])
  assert.equal(directional.length, 2)
  assert.ok(directional.every(call => call.params.descendants === true))
})

test('summary indexes publish nothing after stale navigation', async () => {
  let current = true
  const indexes = await loadSummaryIndexes(814044, {
    get: async () => {
      current = false
      return { data: [{ id: 1 }], headers: { 'pagination-total-pages': '2' } }
    }
  }, () => current)
  assert.equal(indexes, null)
})

test('the rows no directional index names are the only ones worth asking about', () => {
  const rows = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]
  const unresolved = unresolvedDirectionRows(rows, new Set(['1', '4']), new Set(['2']))
  assert.deepEqual(unresolved.map(row => row.id), [3])
})

test('direction comes from the index, and the scope answer places only the leftovers', () => {
  const rows = [
    { id: 1, subject_otu_id: 732556, object_otu_id: 1412679 },
    { id: 2, subject_otu_id: 999, object_otu_id: 732554 },
    { id: 3, subject_otu_id: 999, object_otu_id: 888 },
    { id: 4, subject_otu_id: 732554, object_otu_id: 732556 },
    // Reached through a specimen's determination: no taxon-name filter names it.
    { id: 5, subject_otu_id: 732554, object_otu_id: 1412679 }
  ]
  const split = splitAssociationsByDirection(rows, new Set(['1', '4']), new Set(['2', '4']),
    new Set(['732554']))

  assert.deepEqual(split.asSubject.map(row => row.id), [1, 4, 5])
  assert.deepEqual(split.asObject.map(row => row.id), [2, 4])
})

test('a leftover participant does not move a row the index already placed', () => {
  // All three share the OTU the scope answer names, but only row 3 is waiting
  // on that answer -- row 2 belongs to the object side and stays there.
  const rows = [
    { id: 1, subject_otu_id: 111, object_otu_id: 222 },
    { id: 2, subject_otu_id: 111, object_otu_id: 333 },
    { id: 3, subject_otu_id: 111, object_otu_id: 444 }
  ]
  const split = splitAssociationsByDirection(rows, new Set(['1']), new Set(['2']), new Set(['111']))

  assert.deepEqual(split.asSubject.map(row => row.id), [1, 3])
  assert.deepEqual(split.asObject.map(row => row.id), [2])
})

test('taxon loader batches OTUs and uses one inventory request per OTU with type-safe matching', async () => {
  const calls = []
  const api = { get: async (url, { params }) => {
    calls.push({ url, params })
    return { data: [...otuById.values()].filter(o => o.id === 1411454), headers: { 'pagination-total': '1' } }
  } }
  const data = ['CollectionObject', 'FieldOccurrence'].map((type, i) => ({
    ...row(i + 1, plant, { type, id: 5000, label: type + ' 5000' }), subject_otu_id: 1411454
  }))
  let inventoryCalls = 0
  const result = await loadStandardTaxa([], data, api, async otuId => {
    inventoryCalls++
    assert.equal(otuId, '1411454')
    return [
      { dwc_occurrence_object_type: 'CollectionObject', dwc_occurrence_object_id: 5000, family: 'CO family' },
      { dwc_occurrence_object_type: 'FieldOccurrence', dwc_occurrence_object_id: 5000, family: 'FO family' },
      { dwc_occurrence_object_type: 'AssertedDistribution', dwc_occurrence_object_id: 5000, family: 'Other' }
    ]
  })
  assert.equal(calls.length, 1)
  assert.deepEqual(new URLSearchParams(calls[0].url.split('?')[1]).getAll('otu_id[]'), ['1411454'])
  assert.deepEqual(calls[0].params.extend, ['taxon_name'])
  assert.equal(inventoryCalls, 1)
  assert.equal(result.dwcBySpecimen.get('FieldOccurrence:5000').family, 'FO family')
  assert.equal(result.dwcBySpecimen.size, 2)
})

test('taxon loader canonicalizes a synonym OTU to its accepted name and page', async () => {
  const synonymOtu = {
    id: 1412679,
    taxon_name_id: 1584770,
    taxon_name: {
      id: 1584770,
      cached: 'Apium nodiflorum',
      cached_author_year: '(L.) Lag.',
      rank: 'species',
      cached_is_valid: false,
      cached_valid_taxon_name_id: 1584479
    }
  }
  const acceptedOtu = {
    id: 1412458,
    taxon_name_id: 1584479,
    taxon_name: {
      id: 1584479,
      cached: 'Helosciadium nodiflorum',
      cached_author_year: 'Lag.',
      rank: 'species',
      cached_is_valid: true,
      cached_valid_taxon_name_id: 1584479
    }
  }
  const calls = []
  const api = { get: async (url) => {
    calls.push(url)
    const data = new URLSearchParams(url.split('?')[1]).has('otu_id[]')
      ? [synonymOtu]
      : [acceptedOtu]
    return { data, headers: { 'pagination-total': '1' } }
  } }

  const synonymPlant = { ...plant, id: 1412679, label: 'Apium nodiflorum (L.) Lag.' }
  const result = await loadStandardTaxa([{
    ...row(1, synonymPlant),
    object_otu_id: 1412679
  }], [], api, async () => [])
  const [group] = groupStandardAssociations(
    [{ ...row(1, synonymPlant), object_otu_id: 1412679 }],
    'subject',
    result.otuById
  )

  assert.equal(calls.length, 2)
  assert.equal(group.name, 'Helosciadium nodiflorum')
  assert.equal(group.otuId, 1412458)
  assert.equal(group.key, 'taxon:1584479')
})

test('stale OTU enrichment does not publish results or start specimen requests', async () => {
  let current = true
  const api = { get: async () => {
    current = false
    return { data: [{ id: 1411454 }], headers: { 'pagination-total': '1' } }
  } }
  const result = await loadStandardTaxa([], [{ ...row(1), subject_otu_id: 1411454 }], api,
    () => assert.fail('Should not load inventory'), () => current)
  assert.equal(result, null)
})


test('FO family comes from matching DwC names, never another descendant or an ambiguous family', async () => {
  const api = { get: async () => ({ data: [{ id: 1411454 }], headers: { 'pagination-total': '1' } }) }
  const subjects = [5000, 5001, 5002].map(id => ({
    ...row(id, plant, { type: 'FieldOccurrence', id, label: 'FieldOccurrence ' + id }),
    subject_otu_id: 1411454
  }))
  const result = await loadStandardTaxa([], subjects, api, async () => [
    { dwc_occurrence_object_type: 'FieldOccurrence', dwc_occurrence_object_id: 5000, scientificName: 'Sibinia vittata Germar, 1823' },
    { dwc_occurrence_object_type: 'FieldOccurrence', dwc_occurrence_object_id: 5001, scientificName: 'Unclassified species' },
    { dwc_occurrence_object_type: 'FieldOccurrence', dwc_occurrence_object_id: 5002, scientificName: 'Ambiguous species' },
    { dwc_occurrence_object_type: 'CollectionObject', dwc_occurrence_object_id: 1, scientificName: 'Sibinia vittata Germar, 1823', family: 'Curculionidae' },
    { dwc_occurrence_object_type: 'CollectionObject', dwc_occurrence_object_id: 2, scientificName: 'Another descendant', family: 'Another family' },
    { dwc_occurrence_object_type: 'CollectionObject', dwc_occurrence_object_id: 3, scientificName: 'Ambiguous species', family: 'Family A' },
    { dwc_occurrence_object_type: 'CollectionObject', dwc_occurrence_object_id: 4, scientificName: 'Ambiguous species', family: 'Family B' }
  ])
  assert.equal(result.dwcBySpecimen.get('FieldOccurrence:5000').family, 'Curculionidae')
  assert.equal(result.dwcBySpecimen.get('FieldOccurrence:5001').family, null)
  assert.equal(result.dwcBySpecimen.get('FieldOccurrence:5002').family, null)
})

test('family placeholders permit authoritative ancestry fallback', async () => {
  const otus = new Map(otuById)
  const records = ['Not specified', 'Not available', null].map((family, index) =>
    row(index + 1, { ...plant, family })
  )
  const filled = await enrichAssociationFamilies(records, {
    get: async () => { throw new Error('Cached taxonomy should need no request') }
  }, otus, new Map([['1583501', 'Caryophyllaceae']]))
  assert.ok(filled.every(record => record.object.family === 'Caryophyllaceae'))
})

test('an unlinked OTU retains its complete label without a taxon-page link or inferred family', async () => {
  const unlinked = { id: 999, name: 'unknown host plant A', taxon_name_id: null, taxon_name: null }
  const otus = new Map([...otuById, ['999', unlinked]])
  const records = [{ ...row(1, { id: 999, type: 'Otu', label: unlinked.name, family: null }), object_otu_id: 999 }]
  const filled = await enrichAssociationFamilies(records, {
    get: async () => { throw new Error('An unlinked OTU has no taxonomy to query') }
  }, otus)
  const [group] = groupStandardAssociations(filled, 'subject', otus)
  assert.deepEqual(group.families, [])
  assert.equal(group.name, 'unknown host plant A')
  assert.equal(group.otuId, null)
  assert.equal(group.italic, false)
  assert.equal(group.count, 1)
})

test('shared enrichment loads ancestry only for a linked TaxonName', async () => {
  const calls = []
  const otus = new Map(otuById)
  const filled = await enrichAssociationFamilies([row(1, { ...plant, family: null })], {
    get: async url => {
      calls.push(url)
      if (url === '/taxon_names/1583501') return {
        data: { ancestor_ids: [[42, 'NomenclaturalRank::Icn::FamilyGroup::Family']] }
      }
      assert.equal(new URLSearchParams(url.split('?')[1]).get('taxon_name_id[]'), '42')
      return { data: [{ id: 42, cached: 'Caryophyllaceae' }], headers: { 'pagination-total': '1' } }
    }
  }, otus)
  assert.equal(filled[0].object.family, 'Caryophyllaceae')
  assert.equal(calls.length, 2)
})

test('failed ancestry requests can be retried rather than cached as absent taxonomy', async () => {
  const cache = new Map()
  await assert.rejects(
    loadTaxonomicFamilies(['42'], { get: async () => { throw new Error('temporary failure') } }, cache),
    /temporary failure/
  )
  assert.equal(cache.has('42'), false)
  await loadTaxonomicFamilies(['42'], {
    get: async () => ({ data: { id: 42, rank: 'family', name: 'Caryophyllaceae' } })
  }, cache)
  assert.equal(cache.get('42'), 'Caryophyllaceae')
})

test('gallery pagination preserves distinct depictions of one image without top-level IDs', async () => {
  const gallery = [
    { image: { id: 9 }, depiction_object_id: 1, figure_label: 'A' },
    { image: { id: 9 }, depiction_object_id: 2, figure_label: 'B' }
  ]
  const rows = await fetchAllAssociationPages(async page => ({
    data: [gallery[page - 1]], headers: { 'pagination-total': '2' }
  }), () => true, row => JSON.stringify(row))
  assert.deepEqual(rows, gallery)
})

test('accepted names are resolved only for OTUs whose TaxonName is no longer valid', async () => {
  const calls = []
  const otuById = new Map([
    // A synonym: its TaxonName points at a different, valid TaxonName.
    ['11', { id: 11, taxon_name_id: 111, taxon_name: { id: 111, cached: 'Hypera adspersa', cached_valid_taxon_name_id: 112 } }],
    // A valid name: cached_valid_taxon_name_id is its own id.
    ['22', { id: 22, taxon_name_id: 221, taxon_name: { id: 221, cached: 'Vicia cracca', cached_valid_taxon_name_id: 221 } }],
    // Already resolved by an earlier pass; must not be looked up again.
    ['33', { id: 33, taxon_name_id: 331, taxon_name: { id: 331, cached: 'Berula angustifolia', cached_valid_taxon_name_id: 332 },
      accepted_otu_id: 34, accepted_taxon_name: { id: 332, cached: 'Berula erecta' } }]
  ])
  const api = { get: async (url, options) => {
    calls.push(String(url))
    return { data: [{ id: 12, taxon_name_id: 112, taxon_name: { id: 112, cached: 'Hypera conmaculata' } }],
      headers: { 'pagination-page': String(options.params.page), 'pagination-per-page': String(options.params.per), 'pagination-total': '1' } }
  } }

  const result = await resolveAcceptedNames(otuById, ['11', '22', '33'], api)
  assert.equal(result, otuById)
  assert.equal(calls.length, 1, 'one batched lookup for the one unresolved synonym')
  assert.match(calls[0], /taxon_name_id%5B%5D=112/)

  assert.equal(otuById.get('11').accepted_otu_id, 12)
  assert.equal(otuById.get('11').accepted_taxon_name.cached, 'Hypera conmaculata')
  // The original record is kept untouched beside the accepted values.
  assert.equal(otuById.get('11').taxon_name.cached, 'Hypera adspersa')
  assert.equal(otuById.get('22').accepted_taxon_name, undefined)
  assert.equal(otuById.get('33').accepted_otu_id, 34)
})

test('a page without synonyms costs no accepted-name request', async () => {
  const calls = []
  const otuById = new Map([
    ['11', { id: 11, taxon_name_id: 111, taxon_name: { id: 111, cached: 'Hypera arator', cached_valid_taxon_name_id: 111 } }]
  ])
  const result = await resolveAcceptedNames(otuById, ['11'], { get: async url => { calls.push(url); return { data: [], headers: {} } } })
  assert.equal(result, otuById)
  assert.deepEqual(calls, [])
})

test('an accepted TaxonName without its own OTU still supplies the current name', async () => {
  const otuById = new Map([
    ['11', { id: 11, taxon_name_id: 111, taxon_name: { id: 111, cached: 'Melandrium album', cached_valid_taxon_name_id: 112 } }]
  ])
  const page = (data, options) => ({ data, headers: {
    'pagination-page': String(options.params.page), 'pagination-per-page': String(options.params.per),
    'pagination-total': String(data.length)
  } })
  const api = { get: async (url, options) => String(url).startsWith('/otus')
    ? page([], options)
    : page([{ id: 112, cached: 'Silene latifolia' }], options) }

  await resolveAcceptedNames(otuById, ['11'], api)
  assert.equal(otuById.get('11').accepted_otu_id, null)
  assert.equal(otuById.get('11').accepted_taxon_name.cached, 'Silene latifolia')
})

test('concurrent batches return the same rows in the same order as serial ones', async () => {
  // Bulk loads (every OTU of a taxon, every ancestor of its names) are the only
  // reason this has a concurrency setting at all. It may shorten the wait; it
  // must never change what comes back.
  const ids = Array.from({ length: 450 }, (_, index) => index + 1)
  const run = async concurrency => {
    let inFlight = 0
    let peak = 0
    const rows = await fetchRowsInBatches(ids, async (batch, page, per) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise(resolve => setTimeout(resolve, 0))
      inFlight--
      return { data: batch.map(id => ({ id })), headers: {
        'pagination-page': String(page), 'pagination-per-page': String(per), 'pagination-total': String(batch.length)
      } }
    }, () => true, row => row.id, concurrency)
    return { rows, peak }
  }

  const serial = await run(1)
  const parallel = await run(3)
  assert.equal(serial.peak, 1)
  assert.equal(parallel.peak, 3)
  assert.deepEqual(parallel.rows.map(row => row.id), serial.rows.map(row => row.id))
  assert.deepEqual(serial.rows.map(row => row.id), ids)
})

test('a stale bulk load is abandoned rather than returned half-read', async () => {
  let current = true
  const rows = await fetchRowsInBatches(
    Array.from({ length: 300 }, (_, index) => index + 1),
    async batch => {
      current = false
      return { data: batch.map(id => ({ id })), headers: { 'pagination-total': String(batch.length) } }
    },
    () => current, row => row.id, 3
  )
  assert.equal(rows, null)
})

test('the page collector stops at a row ceiling and labels the list partial', async () => {
  // Advanced holds every record of a taxon in memory so that filters and
  // sorting can cover them. A project large enough to break that has to stop
  // somewhere visible rather than read without end.
  const issues = []
  const rows = await fetchAllAssociationPages(
    async (page, per) => ({
      data: Array.from({ length: per }, (_, index) => ({ id: (page - 1) * per + index + 1 })),
      headers: { 'pagination-page': String(page), 'pagination-per-page': String(per), 'pagination-total': '100000' }
    }),
    () => true, row => row.id, 100, issue => issues.push(issue), 250
  )
  assert.equal(rows.length, 300, 'the page in progress is kept whole')
  assert.deepEqual(issues, ['Only the first 300 records were read; filters and sorting cover those.'])
})
