import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ADVANCED_COLUMNS, advancedParticipant, advancedScope, columnValues, defaultAdvancedSettings, filterAdvancedRows,
  makeAdvancedRows, nextAdvancedSort, normalizeAdvancedSettings, sortAdvancedRows, splitAdvancedName, translateNameFilters } from './advancedAssociations.js'
import { loadAdvancedClassification, loadAdvancedMetadata } from './loadAdvancedAssociations.js'
import { loadStandardTaxa } from './loadStandardAssociations.js'
import { readBrowserSession, writeBrowserSession } from './browserSessionStorage.js'

const taxon = (id, cached, extra = {}) => ({ id, cached, rank: 'species', ...extra })
const otu = (id, name) => ({ id, taxon_name_id: name.id, taxon_name: name })
const rows = [
  { id: 1, relationship: 'reared from', subject_otu_id: 11, object_otu_id: 22,
    subject: { type: 'FieldOccurrence', id: 5, family: 'Curculionidae', label: 'FieldOccurrence 5; record' },
    object: { type: 'AnatomicalPart', id: 5, family: 'Apiaceae', label: 'leaf: Apium nodiflorum (L.) Lag.' } },
  { id: 2, relationship: 'undefined relationship with', subject_otu_id: 11, object_otu_id: 22,
    subject: { type: 'AnatomicalPart', id: 9, family: 'Curculionidae', label: 'larvae: Hypera adspersa' },
    object: { type: 'Otu', id: 22, family: 'Apiaceae', label: 'Apium nodiflorum' } }
]
const taxa = {
  otuById: new Map([
    ['11', { ...otu(11, taxon(111, 'Hypera (Eririnomorphus) adspersa', { cached_author_year: '(Fabricius, 1792)' })),
      accepted_taxon_name: taxon(112, 'Hypera (Eririnomorphus) conmaculata', { cached_author_year: '(Herbst, 1795)' }), accepted_otu_id: 12 }],
    ['22', { ...otu(22, taxon(221, 'Apium nodiflorum', { cached_author_year: '(L.) Lag.' })),
      accepted_taxon_name: taxon(222, 'Helosciadium nodiflorum', { cached_author_year: 'Lag.' }), accepted_otu_id: 23 }]
  ]),
  dwcBySpecimen: new Map([['FieldOccurrence:5', { scientificName: 'Hypera adspersa', country: 'Germany' }]])
}

test('full epithets, subgenus and authorship are separated without shortening', () => {
  assert.deepEqual(splitAdvancedName('Hypera (Eririnomorphus) conmaculata testacea (Herbst, 1795)'), {
    genus: 'Hypera', subgenus: 'Eririnomorphus', species: 'conmaculata testacea', authorship: '(Herbst, 1795)'
  })
  assert.deepEqual(splitAdvancedName('Dianthus carthusianorum subsp. saxigenus', 'Schur'), {
    genus: 'Dianthus', subgenus: '', species: 'carthusianorum subsp. saxigenus', authorship: 'Schur'
  })
})

test('both synonym switches are independent, including FO names, authors and links', () => {
  const settings = defaultAdvancedSettings()
  let result = makeAdvancedRows(rows, taxa, settings)
  assert.equal(result[0].subject.species, 'conmaculata')
  assert.equal(result[0].object.genus, 'Helosciadium')
  assert.equal(result[0].subject.otuId, 12)
  assert.equal(result[0].subject.part, 'adult')
  assert.equal(result[0].object.part, 'leaf')
  assert.equal(result[1].object.part, 'whole plant')
  settings.original.subject = true
  result = makeAdvancedRows(rows, taxa, settings)
  assert.equal(result[0].subject.species, 'Hypera (Eririnomorphus) adspersa now Hypera (Eririnomorphus) conmaculata')
  assert.equal(result[0].subject.authorship, '(Fabricius, 1792)')
  assert.equal(result[0].subject.otuId, 11)
  assert.equal(result[0].object.genus, 'Helosciadium')
  settings.original.object = true
  assert.equal(makeAdvancedRows(rows, taxa, settings)[0].object.genus, 'Apium')
})

test('resolving an additional side retains synonyms already cached by Standard', async () => {
  const cached = new Map(taxa.otuById)
  cached.set('11', { ...otu(11, taxon(111, 'Hypera adspersa', { cached_valid_taxon_name_id: 112 })) })
  const result = await loadStandardTaxa(rows, rows, {
    get: async url => {
      const query = new URL(url, 'https://example.test').searchParams
      assert.deepEqual(query.getAll('taxon_name_id[]'), ['112'])
      return { data: [otu(12, taxon(112, 'Hypera conmaculata'))], headers: { 'pagination-total': '1' } }
    }
  }, async () => [], () => true, cached)
  assert.equal(result.otuById.get('11').accepted_taxon_name.cached, 'Hypera conmaculata')
  assert.equal(result.otuById.get('22').accepted_taxon_name.cached, 'Helosciadium nodiflorum')
  assert.equal(result.otuById.get('22').accepted_otu_id, 23)
})

test('associations with bare OTUs are excluded; named taxa without family remain unlinked', () => {
  const bare = { otuById: new Map([['11', { id: 11, name: 'unidentified Hypera sample 42' }]]), dwcBySpecimen: new Map() }
  const result = advancedParticipant(rows[0], 'subject', bare)
  assert.equal(result.species, 'unidentified Hypera sample 42')
  assert.equal(result.otuId, null)
  assert.equal(result.italic, false)
  assert.deepEqual(makeAdvancedRows(rows, bare, defaultAdvancedSettings()), [])
  const noFamily = { ...rows[0], subject: { ...rows[0].subject, family: null } }
  assert.equal(advancedParticipant(noFamily, 'subject', taxa).otuId, null)
})

test('FO/CO participants use resolved taxon names and family ancestry', () => {
  const specimenRow = {
    id: 3, subject_otu_id: 31, object_otu_id: 32, relationship: 'collected from',
    subject: { type: 'FieldOccurrence', id: 5000, family: null, label: 'FieldOccurrence 5000; record' },
    object: { type: 'AnatomicalPart', id: 6000, family: null, label: 'leaf: Dianthus carthusianorum' }
  }
  const specimenTaxa = {
    otuById: new Map([
      ['31', otu(31, taxon(311, 'Hypera arator'))],
      ['32', otu(32, taxon(321, 'Dianthus carthusianorum'))]
    ]),
    dwcBySpecimen: new Map()
  }
  const classification = new Map([
    ['311', { family: 'Curculionidae' }],
    ['321', { family: 'Caryophyllaceae' }]
  ])
  const [row] = makeAdvancedRows([specimenRow], specimenTaxa, defaultAdvancedSettings(), {}, classification, true)
  assert.equal(row.subject.family, 'Curculionidae')
  assert.equal(row.subject.species, 'arator')
  assert.equal(row.subject.specimen.type, 'FieldOccurrence')
  assert.equal(row.object.family, 'Caryophyllaceae')
  assert.equal(row.object.part, 'leaf')
  assert.equal(row.object.species, 'carthusianorum')
})

test('switching displayed synonyms preserves active name selections', () => {
  const settings = defaultAdvancedSettings()
  settings.filters['subject.species'] = ['conmaculata', 'an absent taxon']
  const before = makeAdvancedRows(rows, taxa, settings)
  settings.original.subject = true
  const after = makeAdvancedRows(rows, taxa, settings)
  settings.filters = translateNameFilters(before, after, settings.filters, 'subject')
  assert.deepEqual(settings.filters['subject.species'], ['Hypera (Eririnomorphus) adspersa now Hypera (Eririnomorphus) conmaculata', 'an absent taxon'])
  assert.equal(filterAdvancedRows(after, settings).length, 2)
})

const familyRow = (objectFamily, label) => ({ id: 7, relationship: 'feeds on', subject_otu_id: 11, object_otu_id: 44,
  subject: { type: 'Otu', id: 11, family: 'Curculionidae', label: 'Hypera adspersa' },
  object: { type: 'Otu', id: 44, family: objectFamily, label } })
const objectTaxa = taxonName => ({ dwcBySpecimen: new Map(),
  otuById: new Map([['44', taxonName ? otu(44, taxonName) : { id: 44 }]]) })

test('a family fills the Family column and leaves Genus and Species empty', () => {
  // splitAdvancedName can read a one-word name as nothing but a genus, so the
  // family used to be repeated in Genus -- italic, and the only link of the row.
  const name = taxon(441, 'Bromeliaceae', { rank: 'family' })
  for (const [indexFamily, what] of [['Bromeliaceae', 'the index names the family'], [null, 'only the rank does']]) {
    const participant = advancedParticipant(familyRow(indexFamily, 'Bromeliaceae'), 'object',
      objectTaxa(name), false, new Map(), false, true)
    assert.equal(participant.family, 'Bromeliaceae', what)
    assert.equal(participant.genus, '', what)
    assert.equal(participant.species, '', what)
    assert.deepEqual(participant.genusNames, [])
    assert.deepEqual(participant.speciesNames, [])
    // The link moves with the name instead of disappearing with the cell.
    assert.deepEqual(participant.familyNames, [{ name: 'Bromeliaceae', authorship: '', otuId: 44 }])
  }
  const rowsWithFamily = makeAdvancedRows([familyRow('Bromeliaceae', 'Bromeliaceae')],
    { ...taxa, otuById: new Map([...taxa.otuById, ['44', otu(44, name)]]) }, defaultAdvancedSettings(), {}, new Map(), true)
  assert.deepEqual(columnValues(rowsWithFamily[0], 'object.family'), ['Bromeliaceae'])
  assert.deepEqual(columnValues(rowsWithFamily[0], 'object.genus'), [''])
})

test('an OTU without a TaxonName is read as a family only when its name ends like one', () => {
  // Nothing records a rank for these, and the index has no family either. The
  // ICN reserves -aceae and the ICZN -idae for family names; no genus can end
  // that way, so the name itself is the only evidence there is.
  const family = advancedParticipant(familyRow(null, 'Lauraceae'), 'object', objectTaxa(null), false, new Map(), false, true)
  assert.equal(family.family, 'Lauraceae')
  assert.equal(family.genus, '')
  assert.deepEqual(family.familyNames, [{ name: 'Lauraceae', authorship: '', otuId: 44 }])

  const genus = advancedParticipant(familyRow(null, 'Juniperus'), 'object', objectTaxa(null), false, new Map(), false, true)
  assert.equal(genus.genus, 'Juniperus')
  assert.equal(genus.family, '')
})

test('a tribe or subfamily keeps its name, because its family is a different one', () => {
  // Subfamily and Tribe are optional columns and hidden by default: moving these
  // names to Family would overwrite Curculionidae and drop them from the table.
  for (const rank of ['tribe', 'subfamily']) {
    const name = taxon(442, rank === 'tribe' ? 'Zygopini' : 'Nanophyinae', { rank })
    const participant = advancedParticipant(familyRow('Curculionidae', name.cached), 'object',
      objectTaxa({ ...name, cached_author_year: 'Schoenherr, 1823' }), false, new Map(), true, true)
    assert.equal(participant.family, 'Curculionidae', rank)
    // It sits in the Genus column, but it is no more a species than a family is:
    // the authorship switch leaves it alone.
    assert.equal(participant.genus, name.cached, rank)
    assert.deepEqual(participant.genusNames.map(value => value.authorship), [''], rank)
    assert.deepEqual(participant.familyNames, [{ name: 'Curculionidae', authorship: '', otuId: null }])
  }
})

test('a genus with no species of its own carries no authorship, switch on or off', () => {
  const genusTaxa = { ...taxa, otuById: new Map([
    ['22', otu(22, taxon(221, 'Apium', { rank: 'genus', cached_author_year: 'L., 1753' }))]
  ]) }
  for (const showAuthorship of [false, true]) {
    const participant = advancedParticipant(rows[1], 'object', genusTaxa, false, new Map(), showAuthorship)
    // The switch offers authorship for species names. A bare genus has no
    // epithet for one to belong to, so the Genus column reads the same either way.
    assert.equal(participant.genus, 'Apium')
    assert.deepEqual(participant.genusNames.map(name => name.name), ['Apium'])
    assert.deepEqual(participant.genusNames.map(name => name.authorship), [''])
    assert.equal(participant.species, '')
    assert.deepEqual(participant.speciesNames, [])
    // A genus is not its family, so the Family column keeps the index value and
    // stays plain text.
    assert.equal(participant.family, 'Apiaceae')
    assert.deepEqual(participant.familyNames, [{ name: 'Apiaceae', authorship: '', otuId: null }])
  }
})

test('neither reading of a genus-level synonym pair takes authorship with it', () => {
  const genusTaxa = { ...taxa, otuById: new Map([
    ['22', { ...otu(22, taxon(221, 'Apium', { rank: 'genus', cached_author_year: 'L., 1753' })),
      accepted_taxon_name: taxon(222, 'Helosciadium', { rank: 'genus', cached_author_year: 'W.D.J.Koch' }),
      accepted_otu_id: 23 }]
  ]) }
  const participant = advancedParticipant(rows[1], 'object', genusTaxa, true, new Map(), true)

  assert.equal(participant.genus, 'Apium now Helosciadium')
  assert.deepEqual(participant.genusNames.map(name => name.authorship), ['', ''])
  assert.deepEqual(participant.speciesNames, [])
})

test('authorship is optional in Species and accompanies both full synonym names', () => {
  const settings = { ...defaultAdvancedSettings(), showAuthorship: true }
  let result = makeAdvancedRows(rows, taxa, settings)
  assert.equal(result[0].subject.species, 'conmaculata (Herbst, 1795)')
  settings.original = { subject: true, object: true }
  result = makeAdvancedRows(rows, taxa, settings)
  assert.equal(result[0].subject.species,
    'Hypera (Eririnomorphus) adspersa (Fabricius, 1792) now Hypera (Eririnomorphus) conmaculata (Herbst, 1795)')
  assert.equal(result[0].object.species, 'Apium nodiflorum (L.) Lag. now Helosciadium nodiflorum Lag.')
  // The synonym itself is not a link: its OTU page carries the nomenclature but
  // none of the records, so both readings lead to the accepted name or nowhere.
  assert.deepEqual(result[0].object.speciesNames.map(name => name.otuId), [null, 23])
  const without = makeAdvancedRows(rows, taxa, { ...settings, showAuthorship: false })
  const filters = translateNameFilters(result, without, { 'object.species': [result[0].object.species] }, 'object')
  assert.equal(filterAdvancedRows(without, { ...settings, filters }).length, 2)
  const sameNameTaxa = { ...taxa, otuById: new Map(taxa.otuById) }
  const original = sameNameTaxa.otuById.get('22')
  sameNameTaxa.otuById.set('22', { ...original, accepted_taxon_name: original.taxon_name })
  assert.equal(makeAdvancedRows(rows, sameNameTaxa, settings)[0].object.species, 'nodiflorum (L.) Lag.')
})

test('all relationships and records with or without images are visible by default; only 50/100 remain', () => {
  const settings = defaultAdvancedSettings()
  const input = [...rows, { ...rows[0], id: 3, relationship: 'legacy host' }]
  const result = makeAdvancedRows(input, taxa, settings, { depictions: new Map([['1', [{ id: 5 }]]]) })
  assert.deepEqual(filterAdvancedRows(result, settings).map(row => row.id), [1, 2, 3])
  assert.equal(result[0].depictions, 'Present')
  assert.ok(!settings.columns.includes('depictions'))
  assert.ok(!settings.columns.includes('area'))
  assert.equal(settings.showAuthorship, false)
  assert.ok(ADVANCED_COLUMNS.filter(column => column.field === 'tribe').every(column => column.optional))
  assert.ok(!ADVANCED_COLUMNS.some(column => column.field === 'authorship'))
  const migrated = normalizeAdvancedSettings({ columns: ['subject.authorship', 'subject.species'], per: 200,
    filters: { 'subject.authorship': ['L.'] }, sort: { key: 'subject.authorship', direction: 'asc' } })
  assert.equal(migrated.per, 50)
  assert.deepEqual(migrated.columns, ['subject.species'])
  assert.deepEqual(migrated.filters, {})
  assert.deepEqual(migrated.sort, settings.sort)
})

test('saved Advanced filters can explain an empty page and reset restores its rows', () => {
  const saved = normalizeAdvancedSettings({ filters: { 'subject.species': ['a taxon from another page'] } })
  const result = makeAdvancedRows(rows, taxa, saved)
  assert.equal(filterAdvancedRows(result, saved).length, 0)

  const reset = normalizeAdvancedSettings({ ...saved, filters: {} })
  assert.equal(filterAdvancedRows(result, reset).length, rows.length)
})

test('sorting cycles through ascending, descending and the unmarked original order', () => {
  const result = makeAdvancedRows(rows, taxa, defaultAdvancedSettings())
  const original = sortAdvancedRows(result, null).map(row => row.id)
  let sort = nextAdvancedSort(null, 'subject.part')
  assert.deepEqual(sort, { key: 'subject.part', direction: 'asc' })
  sort = nextAdvancedSort(sort, 'subject.part')
  assert.deepEqual(sort, { key: 'subject.part', direction: 'desc' })
  assert.deepEqual(sortAdvancedRows(result, sort).map(row => row.id), [2, 1])
  sort = nextAdvancedSort(sort, 'subject.part')
  assert.equal(sort, null)
  assert.deepEqual(sortAdvancedRows(result, sort).map(row => row.id), original)
  assert.equal(normalizeAdvancedSettings({ sort }).sort, null)
  assert.deepEqual(nextAdvancedSort({ key: 'object.genus', direction: 'desc' }, 'subject.part'),
    { key: 'subject.part', direction: 'asc' })
})

test('one Data attribute selection shows or hides both columns, including old saved selections', () => {
  for (const columns of [['attribute'], ['value'], ['attribute', 'value']]) {
    const result = normalizeAdvancedSettings({ columns }).columns
    assert.deepEqual(result, columns[0] === 'value' ? ['value', 'attribute'] : ['attribute', 'value'])
  }
  assert.deepEqual(normalizeAdvancedSettings({ columns: ['subject.species'] }).columns, ['subject.species'])
  assert.ok(!defaultAdvancedSettings().columns.includes('attribute'))
})

test('Citations use individual Raw data short labels, including year suffixes, for display and filtering', async () => {
  const settings = defaultAdvancedSettings()
  const citationRows = [
    { id: 10, citation_object_id: 1, citation_source_body: 'Dieckmann, 1989a' },
    { id: 20, citation_object_id: 1, citation_source_body: 'Scherf, 1964' }
  ]
  const citations = await loadAdvancedMetadata([1, 2], 'citations', { get: async url => {
    const query = new URL(url, 'https://example.test')
    assert.equal(query.pathname, '/citations')
    assert.equal(query.searchParams.get('citation_object_type'), 'BiologicalAssociation')
    assert.deepEqual(query.searchParams.getAll('citation_object_id[]'), ['1', '2'])
    return { data: citationRows, headers: { 'pagination-total': '2' } }
  } })
  const result = makeAdvancedRows(rows, taxa, settings, { citations })
  assert.deepEqual(columnValues(result[0], 'citations'), ['Dieckmann, 1989a', 'Scherf, 1964'])
  assert.equal(result[0].citationList[0].id, 10)
  assert.equal(filterAdvancedRows(result, { ...settings, filters: { citations: ['Dieckmann, 1989a'] } }).length, 1)
})

test('only a publication is offered as a reference; people and credits are notes', async () => {
  const settings = defaultAdvancedSettings()
  const requested = []
  const citations = await loadAdvancedMetadata([1, 2], 'citations', { get: async url => {
    const query = new URL(url, 'https://example.test')
    requested.push(query.pathname)
    if (query.pathname === '/sources') {
      assert.deepEqual(query.searchParams.getAll('source_id[]'), ['900', '901'])
      return { data: [
        { id: 900, type: 'Source::Bibtex', cached: 'Scherf, H. (1964) Die Entwicklungsstadien.' },
        { id: 901, type: 'Source::Verbatim', cached: '© 2018 Katja Schulz' }
      ], headers: { 'pagination-total': '2' } }
    }
    return { data: [
      { id: 10, citation_object_id: 1, source_id: 900, citation_source_body: 'Scherf, 1964' },
      { id: 11, citation_object_id: 1, source_id: 901, citation_source_body: '© 2018 Katja Schulz' }
    ], headers: { 'pagination-total': '2' } }
  } })

  assert.deepEqual(requested, ['/citations', '/sources'])
  const result = makeAdvancedRows(rows, taxa, settings, { citations })
  // The publication stays clickable and carries its full text, so the modal
  // opens without another request.
  assert.deepEqual(result[0].citationList.map(citation => citation.id), [10])
  assert.match(result[0].citationList[0].full, /Entwicklungsstadien/)
  // The photo credit is not a source in any useful sense -- it is shown, but
  // never as a link to a reference that does not exist.
  assert.deepEqual(result[0].citationNotes, ['© 2018 Katja Schulz'])
  // Filtering and copying still see the column exactly as it reads.
  assert.deepEqual(columnValues(result[0], 'citations'), ['Scherf, 1964', '© 2018 Katja Schulz'])
})

test('a collector name from the index is shown but never linked', async () => {
  const settings = defaultAdvancedSettings()
  // TaxonWorks puts the collector or determiner into the index's `citations`
  // field whenever the record has no citation of its own -- 783 of the 3000
  // records in this project, e.g. "Yunakov N.N." or "Jakob Jilg".
  const withCollector = rows.map(row => ({ ...row, citations: 'Yunakov N.N.' }))
  const result = makeAdvancedRows(withCollector, taxa, settings, { citations: new Map() })

  assert.deepEqual(result[0].citationList, [])
  assert.deepEqual(result[0].citationNotes, ['Yunakov N.N.'])
  assert.deepEqual(columnValues(result[0], 'citations'), ['Yunakov N.N.'],
    'the name stays selectable in the column filter')
})

test('a specimen collector is a note as well, not a reference', () => {
  const settings = defaultAdvancedSettings()
  const collected = {
    otuById: taxa.otuById,
    dwcBySpecimen: new Map([['FieldOccurrence:5', { scientificName: 'Hypera adspersa', recordedBy: 'Jakob Jilg' }]])
  }
  const result = makeAdvancedRows(rows, collected, settings, { citations: new Map() })
  assert.deepEqual(result[0].citationList, [])
  assert.deepEqual(result[0].citationNotes, ['Jakob Jilg'])
})

test('gallery metadata keeps records that have no top-level ID', async () => {
  const result = await loadAdvancedMetadata([1, 2], 'depictions', {
    get: async url => {
      assert.equal(new URL(url, 'https://example.test').pathname, '/depictions/gallery')
      return { data: [
        { image: { id: 9 }, depiction_object_id: 1 },
        { image: { id: 9 }, depiction_object_id: 2 }
      ], headers: { 'pagination-total': '2' } }
    }
  })
  assert.equal(result.get('1').length, 1)
  assert.equal(result.get('2').length, 1)
})

test('session sharing works on HTTP where randomUUID is unavailable', () => {
  const values = new Map()
  const browser = { document: { cookie: '' }, location: { protocol: 'http:' },
    crypto: { getRandomValues: bytes => bytes.fill(10) },
    localStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) } }
  writeBrowserSession('test', { per: 100 }, browser)
  assert.deepEqual(readBrowserSession('test', browser), { per: 100 })
  assert.ok(!browser.document.cookie.includes('Secure'))
})

test('a searched filter selection is applied to the table', () => {
  const settings = defaultAdvancedSettings()
  const result = makeAdvancedRows(rows, taxa, settings)

  const searchedValue = result[0].object.species
  result[1].object.species = 'other plant'

  settings.filters = {
    'object.species': [searchedValue]
  }

  const filtered = filterAdvancedRows(result, settings)

  assert.equal(filtered.length, 1)
  assert.equal(filtered[0].id, 1)
})

test('all column filtering and ordering happens before a 50/100-row page is sliced', () => {
  const settings = defaultAdvancedSettings()
  const all = Array.from({ length: 210 }, (_, index) => ({ ...rows[0], id: index + 1 }))
  const result = makeAdvancedRows(all, taxa, settings)
  result[205].object.species = 'special plant'
  settings.filters['object.species'] = ['special plant']
  const matches = filterAdvancedRows(result, settings)
  assert.equal(matches.length, 1)
  assert.equal(matches[0].id, 206)
  const original = makeAdvancedRows(rows, taxa, defaultAdvancedSettings())
  assert.equal(filterAdvancedRows(original, defaultAdvancedSettings()).length, 2)
  settings.filters = { relationship: ['undefined relationship with'] }
  assert.deepEqual(filterAdvancedRows(original, settings).map(row => row.id), [2])
  assert.deepEqual(sortAdvancedRows(original, { key: 'subject.part', direction: 'desc' }).map(row => row.subject.part), ['larvae', 'adult'])
})

test('attribute name/value filters match the same attribute and blank remains selectable', () => {
  const settings = defaultAdvancedSettings()
  const metadata = { attributes: new Map([['1', [
    { id: 1, name: 'Microhabitat', value: 'underside of leaf' },
    { id: 2, name: 'Confidence', value: 'high' }
  ]]]) }
  const result = makeAdvancedRows(rows, taxa, settings, metadata)
  settings.filters = { attribute: ['Microhabitat'], value: ['high'] }
  assert.equal(filterAdvancedRows(result, settings).length, 0)
  settings.filters.value = ['underside of leaf']
  assert.equal(filterAdvancedRows(result, settings).length, 1)
  assert.deepEqual(columnValues(result[1], 'attribute'), [''])
})

test('browser preferences isolate exact ranks and target groups while existing tabs keep their state', () => {
  const values = new Map()
  const browser = { document: { cookie: '' }, crypto: { randomUUID: () => 'session-1' },
    location: { protocol: 'https:' }, localStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) } }
  const plant = advancedScope({ rank: 'species', nomenclatural_code: 'icn' }, 1)
  const animal = advancedScope({ rank: 'species', nomenclatural_code: 'iczn' }, 2)
  const genus = advancedScope({ rank: 'genus', nomenclatural_code: 'iczn' }, 3)
  const key = scope => `taxonpages:advanced:${scope}`
  const oldTab = { ...defaultAdvancedSettings(), per: 100, filters: { 'subject.part': ['larvae'] } }
  writeBrowserSession(key(animal), oldTab, browser)
  assert.deepEqual(readBrowserSession(key(animal), browser), oldTab)
  assert.equal(readBrowserSession(key(plant), browser), null)
  assert.equal(readBrowserSession(key(genus), browser), null)
  writeBrowserSession(key(animal), { ...oldTab, per: 50 }, browser)
  assert.equal(oldTab.per, 100)
  browser.document.cookie = ''
  assert.equal(readBrowserSession(key(animal), browser), null)
  assert.deepEqual(normalizeAdvancedSettings({ columns: ['bad'], per: 1, sort: { key: 'bad' } }), defaultAdvancedSettings())
})

test('annotation batches use the documented object type and consume all pages', async () => {
  const calls = []
  const api = { get: async (url, { params }) => {
    calls.push({ url, ...params })
    return { data: [{ id: params.page, tag_object_id: 1, keyword: { name: `Tag ${params.page}` } }],
      headers: { 'pagination-total': '2' } }
  } }
  const result = await loadAdvancedMetadata([1], 'tags', api)
  assert.deepEqual(result.get('1'), ['Tag 1', 'Tag 2'])
  assert.equal(calls.length, 2)
  const query = new URL(calls[0].url, 'https://example.test').searchParams
  assert.equal(query.get('tag_object_type[]'), 'BiologicalAssociation')
  assert.deepEqual(query.getAll('tag_object_id[]'), ['1'])
  let current = true
  assert.equal(await loadAdvancedMetadata([1], 'tags', { get: async () => {
    current = false; return { data: [] }
  } }, () => current), null)
})

test('metadata stay within 100 IDs per query and two concurrent batches', async () => {
  let active = 0
  let peak = 0
  let calls = 0
  const ids = Array.from({ length: 230 }, (_, index) => index + 1)
  const result = await loadAdvancedMetadata(ids, 'attributes', { get: async url => {
    active++; peak = Math.max(peak, active); calls++
    const query = new URL(url, 'https://example.test').searchParams
    assert.equal(query.get('attribute_subject_type[]'), 'BiologicalAssociation')
    const batch = query.getAll('attribute_subject_id[]')
    assert.ok(batch.length <= 100)
    await new Promise(resolve => setTimeout(resolve, 2))
    active--
    const data = batch.map(id => ({ id, attribute_subject_id: id, import_predicate: 'origin', value: 'field' }))
    return { data, headers: { 'pagination-total': String(data.length) } }
  } })
  assert.equal(calls, 3)
  assert.equal(peak, 2)
  assert.equal(result.size, 230)
  assert.equal(result.get('230')[0].name, 'origin')
})

test('subfamilies and tribes follow shared parents and cache without per-record ancestry calls', async () => {
  const names = new Map([
    ['30', { id: 30, name: 'Hypera', rank: 'NomenclaturalRank::Iczn::GenusGroup::Genus', parent_id: 35 }],
    ['35', { id: 35, name: 'Hyperini', rank: 'NomenclaturalRank::Iczn::FamilyGroup::Tribe', parent_id: 40 }],
    ['40', { id: 40, name: 'Hyperinae', rank: 'NomenclaturalRank::Iczn::FamilyGroup::Subfamily', parent_id: 50 }],
    ['50', { id: 50, name: 'Curculionidae', rank: 'NomenclaturalRank::Iczn::FamilyGroup::Family', parent_id: 60 }]
  ])
  const otus = new Map([['1', otu(1, taxon(1, 'Hypera alpha', { parent_id: 30 }))], ['2', otu(2, taxon(2, 'Hypera beta', { parent_id: 30 }))]])
  let calls = 0
  const api = { get: async url => {
    calls++
    const ids = new URL(url, 'https://example.test').searchParams.getAll('taxon_name_id[]')
    const data = url.startsWith('/otus?') ? [{ id: 300, taxon_name_id: 30 }] : ids.map(id => names.get(id)).filter(Boolean)
    return { data, headers: { 'pagination-total': String(data.length) } }
  } }
  const cache = new Map()
  let result = await loadAdvancedClassification(otus, api, cache)
  assert.deepEqual(result.get('1'), { family: 'Curculionidae', subfamily: 'Hyperinae', tribe: 'Hyperini', genusOtuId: 300 })
  assert.equal(calls, 5)
  result = await loadAdvancedClassification(otus, api, cache)
  assert.equal(result.get('2').subfamily, 'Hyperinae')
  assert.equal(result.get('2').genusOtuId, 300)
  assert.equal(calls, 5)
})
