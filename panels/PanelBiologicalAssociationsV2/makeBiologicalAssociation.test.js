import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeBiologicalAssociation } from './makeBiologicalAssociation.js'

// Real API shapes captured from /biological_associations?extend[]=object,subject
// on sfg.taxonworks.org (project 40). A CO/FO subject/object serialises its
// determination in a plain `otu_tag` span (no authorship) and its object_label
// is a catalog string, so the label cell must come from the specimen's DWC
// scientificName instead.

const FO_SUBJECT = {
  base_class: 'FieldOccurrence',
  id: 5000,
  object_tag:
    '<span class="feedback feedback-thin feedback-info">1</span>&nbsp;<span class="feedback feedback-thin">det. <span class="otu_tag"><i>Hypera</i> (<i>Kippenbergia</i>) <i>arator</i>&nbsp;<b>Hypera arator</b></span> by Jilg on 2022-7-24</span>',
  object_label:
    'FieldOccurrence 5000; 7034fcb2-1bdb-4c02-93fd-f3e54b8c4733; Germany: Brandenburg\n16248 Oderberg, Germany, 2022/07/24\nJakob Jilg'
}

const OTU_OBJECT = {
  base_class: 'Otu',
  id: 1383723,
  object_tag: '<span class="otu_tag"><i>Dianthus carthusianorum</i> L.</span>',
  object_label: 'Dianthus carthusianorum L.'
}

const baseData = {
  id: 253118,
  subject: FO_SUBJECT,
  object: OTU_OBJECT,
  biological_relationship: { name: 'collected from' }
}

const basic = { subject_otu_id: 1411454, object_otu_id: 1383723 }

test('Expert link metadata requires an explicit TaxonName; family placeholders normalize to blank', () => {
  const otus = new Map([
    ['1411454', { id: 1411454, name: 'unidentified beetle', taxon_name_id: null }],
    ['1383723', { id: 1383723, taxon_name_id: 1583501 }]
  ])
  const ba = makeBiologicalAssociation(baseData, [], [], [], {
    ...basic,
    subject: { family: 'Not specified' },
    object: { family: 'Caryophyllaceae' }
  }, new Map(), otus)
  assert.equal(ba.subjectHasTaxonName, false)
  assert.equal(ba.subjectFamily, null)
  assert.equal(ba.objectHasTaxonName, true)
  assert.equal(ba.objectFamily, 'Caryophyllaceae')
})

test('CO/FO label uses the DWC scientificName (italic name + roman authorship), not the catalog string', () => {
  const locality = new Map([
    ['FieldOccurrence:5000', {
      scientificName: 'Hypera (Kippenbergia) arator (Linnaeus, 1758)',
      family: 'Curculionidae'
    }]
  ])

  const ba = makeBiologicalAssociation(baseData, [], [], [], basic, locality)

  assert.equal(ba.subjectLabelPrefix, null)
  assert.equal(
    ba.subjectSpeciesHtml,
    '<i>Hypera (Kippenbergia) arator</i> (Linnaeus, 1758)'
  )
  // OTU link + specimen modal wiring preserved
  assert.equal(ba.subjectOtuId, 1411454)
  assert.equal(ba.subjectSpecimenType, 'FieldOccurrence')
  assert.equal(ba.subjectSpecimenId, 5000)
  assert.equal(ba.subjectFamily, 'Curculionidae')
  // no leak of the raw "FieldOccurrence 5000; <uuid>; …" string
  assert.ok(!ba.subjectSpeciesHtml.includes('FieldOccurrence 5000'))
})

test('an AnatomicalPart wrapping a CO/FO keeps its part-name prefix and links the DWC name', () => {
  const data = {
    ...baseData,
    subject: {
      base_class: 'AnatomicalPart',
      id: 99,
      object_tag: '<span>nidus: <span class="otu_tag"><i>Hypera arator</i></span></span>',
      object_label: 'nidus: FieldOccurrence 4996; 1234abcd; Germany'
    }
  }
  const locality = new Map([
    ['FieldOccurrence:4996', { scientificName: 'Hypera (Kippenbergia) arator (Linnaeus, 1758)' }]
  ])

  const ba = makeBiologicalAssociation(data, [], [], [], basic, locality)

  assert.equal(ba.subjectLabelPrefix, 'Nidus of ')
  assert.equal(
    ba.subjectSpeciesHtml,
    '<i>Hypera (Kippenbergia) arator</i> (Linnaeus, 1758)'
  )
  assert.equal(ba.subjectSpecimenType, 'FieldOccurrence')
  assert.equal(ba.subjectSpecimenId, 4996)
})

test('an OTU entity takes its marked-up name, authorship included, from the otu_tag span', () => {
  const ba = makeBiologicalAssociation(baseData, [], [], [], basic, new Map())

  // object is the Dianthus OTU: italic name + roman authorship out of the tag,
  // not the flat object_label text
  assert.equal(ba.objectLabelPrefix, null)
  assert.equal(ba.objectSpeciesHtml, '<i>Dianthus carthusianorum</i> L.')
  assert.equal(ba.objectOtuId, 1383723)
  assert.equal(ba.objectSpecimenType, null)
})

test('AnatomicalPart of a taxon (no wrapped specimen) splits into a part prefix + name', () => {
  const data = {
    ...baseData,
    subject: {
      base_class: 'AnatomicalPart',
      id: 42,
      object_tag:
        '<span>larvae: <span class="otu_tag"><i>Hypera</i> (<i>Kippenbergia</i>) <i>arator</i> (Linnaeus, 1758)</span></span>',
      object_label: 'larvae: Hypera (Kippenbergia) arator (Linnaeus, 1758)'
    }
  }

  const ba = makeBiologicalAssociation(data, [], [], [], basic, new Map())

  // resolveSpecimenRef finds no CollectionObject/FieldOccurrence token, so
  // there is no specimen name and no ⓘ button; the part name is still pulled
  // off as a prefix and the ": " head dropped from the body (same shape the
  // specimen-wrapping and name-span AnatomicalPart cases already produce).
  assert.equal(ba.subjectSpecimenType, null)
  assert.equal(ba.subjectLabelPrefix, 'Larvae of ')
  assert.equal(
    ba.subjectSpeciesHtml,
    '<i>Hypera</i> (<i>Kippenbergia</i>) <i>arator</i> (Linnaeus, 1758)'
  )
})

test('CO/FO with no DWC record falls back to the determination in its det. tag', () => {
  const ba = makeBiologicalAssociation(baseData, [], [], [], basic, new Map())

  // Not the catalog string, and not the "<b>Hypera arator</b>" tail TaxonWorks
  // appends to repeat the OTU's own label. Authorship is simply absent from a
  // det. tag — that is the remaining gap the DWC scientificName fills.
  assert.equal(ba.subjectLabelPrefix, null)
  assert.equal(ba.subjectSpeciesHtml, '<i>Hypera</i> (<i>Kippenbergia</i>) <i>arator</i>')
  assert.ok(!ba.subjectSpeciesHtml.includes('FieldOccurrence 5000'))
  assert.ok(!ba.subjectSpeciesHtml.includes('<b>'))
})

test('a CollectionObject and a FieldOccurrence sharing a numeric id do not collide', () => {
  // Two associations on the same page: one whose subject is CollectionObject
  // 5000, one whose subject is FieldOccurrence 5000. Keyed by id alone the
  // second would overwrite the first; keyed by type+id they stay separate.
  const locality = new Map([
    ['CollectionObject:5000', { scientificName: 'Larinus latus (Herbst, 1783)', recordedBy: 'Smith' }],
    ['FieldOccurrence:5000', { scientificName: 'Hypera arator (Linnaeus, 1758)', recordedBy: 'Jilg' }]
  ])

  const coRow = { ...baseData, subject: { ...FO_SUBJECT, base_class: 'CollectionObject', id: 5000 } }
  const foRow = { ...baseData, subject: { ...FO_SUBJECT, base_class: 'FieldOccurrence', id: 5000 } }

  const co = makeBiologicalAssociation(coRow, [], [], [], basic, locality)
  const fo = makeBiologicalAssociation(foRow, [], [], [], basic, locality)

  assert.equal(co.subjectSpeciesHtml, '<i>Larinus latus</i> (Herbst, 1783)')
  assert.equal(co.subjectCollector, 'Smith')
  assert.equal(fo.subjectSpeciesHtml, '<i>Hypera arator</i> (Linnaeus, 1758)')
  assert.equal(fo.subjectCollector, 'Jilg')
})

test('AnatomicalPart fallback (no DWC, no name span) keeps the part-name prefix and drops the catalog head', () => {
  const data = {
    ...baseData,
    subject: {
      base_class: 'AnatomicalPart',
      id: 99,
      object_tag: '<span>nidus: <span class="otu_tag">FieldOccurrence 4996</span></span>',
      object_label: 'nidus: FieldOccurrence 4996; 1234abcd-0000; Germany'
    }
  }

  const ba = makeBiologicalAssociation(data, [], [], [], basic, new Map())

  assert.equal(ba.subjectLabelPrefix, 'Nidus of ')
  assert.equal(ba.subjectSpeciesHtml, 'FieldOccurrence 4996')
  assert.ok(!ba.subjectSpeciesHtml.startsWith('nidus:'))
  // the uuid and locality of the object_label stay out of the label cell
  assert.ok(!ba.subjectSpeciesHtml.includes('1234abcd-0000'))
})

// Synonyms. Raw data keeps the name the association was recorded under and
// keeps its link, and prints the name in current use after it, with its own
// link to the OTU that carries the records. Shapes below are the two TaxonWorks
// actually emits, captured from project 40 (2026-09-21).

// An OTU filed under a Combination: the tag carries a "[c]" marker and no
// "now" tail of its own (OTU 737324, Calystegia sepium -> Convolvulus sepium).
const COMBINATION_OBJECT = {
  base_class: 'Otu',
  id: 737324,
  object_tag: '<span class="otu_tag"><i>Calystegia sepium</i> [c]</span>',
  object_label: 'Calystegia sepium R.Br. [c]'
}

const combinationOtu = {
  id: 737324,
  taxon_name_id: 1628688,
  taxon_name: { id: 1628688, cached: 'Calystegia sepium', cached_valid_taxon_name_id: 1628614 },
  accepted_otu_id: 737327,
  accepted_taxon_name: {
    id: 1628614,
    cached: 'Convolvulus sepium',
    cached_html: '<i>Convolvulus sepium</i>',
    cached_author_year: 'R.Br.'
  }
}

test('a combination OTU drops the "[c]" marker and gains the accepted name', () => {
  const data = { ...baseData, object: COMBINATION_OBJECT }
  const ba = makeBiologicalAssociation(
    data, [], [], [], { ...basic, object_otu_id: 737324, object: { family: 'Convolvulaceae' } },
    new Map(), new Map([['737324', combinationOtu]])
  )

  assert.equal(ba.objectSpeciesHtml, '<i>Calystegia sepium</i>')
  assert.equal(ba.objectOtuId, 737324)
  assert.equal(ba.objectAcceptedNameHtml, '<i>Convolvulus sepium</i> R.Br.')
  assert.equal(ba.objectAcceptedOtuId, 737327)
})

test('a synonym whose tag already says "now" is not printed twice', () => {
  // OTU 708190: TaxonWorks renders the accepted name inside the tag itself.
  const data = {
    ...baseData,
    object: {
      base_class: 'Otu',
      id: 708190,
      object_tag: '<span class="otu_tag"><i>Brachytarsus</i> Schönherr, 1823 <em>now</em> <i>Anthribus</i> Geoffroy, 1762</span>',
      object_label: 'Brachytarsus Schönherr, 1823 now Anthribus Geoffroy, 1762'
    }
  }
  const otu = {
    id: 708190,
    taxon_name_id: 809416,
    taxon_name: { id: 809416, cached: 'Brachytarsus', cached_valid_taxon_name_id: 809415 },
    accepted_otu_id: 708191,
    accepted_taxon_name: {
      id: 809415, cached: 'Anthribus', cached_html: '<i>Anthribus</i>', cached_author_year: 'Geoffroy, 1762'
    }
  }
  const ba = makeBiologicalAssociation(
    data, [], [], [], { ...basic, object_otu_id: 708190, object: { family: 'Anthribidae' } },
    new Map(), new Map([['708190', otu]])
  )

  // "sp." and no genus authorship: the panel's existing bare-genus policy,
  // which the cut-back name falls under like any other genus-rank partner.
  assert.equal(ba.objectSpeciesHtml, '<i>Brachytarsus</i> sp.')
  assert.ok(!ba.objectSpeciesHtml.includes('now'))
  assert.equal(ba.objectAcceptedNameHtml, '<i>Anthribus</i> Geoffroy, 1762')
  assert.equal(ba.objectAcceptedOtuId, 708191)
})

test("TaxonWorks' own \"now\" tail is kept when the accepted name could not be resolved", () => {
  const data = {
    ...baseData,
    object: {
      base_class: 'Otu',
      id: 708190,
      object_tag: '<span class="otu_tag"><i>Brachytarsus</i> Schönherr, 1823 <em>now</em> <i>Anthribus</i> Geoffroy, 1762</span>',
      object_label: 'Brachytarsus Schönherr, 1823 now Anthribus Geoffroy, 1762'
    }
  }
  const ba = makeBiologicalAssociation(data, [], [], [], { ...basic, object_otu_id: 708190 })

  assert.equal(
    ba.objectSpeciesHtml,
    '<i>Brachytarsus</i> Schönherr, 1823 <em>now</em> <i>Anthribus</i> Geoffroy, 1762'
  )
  assert.equal(ba.objectAcceptedNameHtml, null)
})

test('an accepted TaxonName without an OTU of its own is shown without a link', () => {
  const data = { ...baseData, object: COMBINATION_OBJECT }
  const ba = makeBiologicalAssociation(
    data, [], [], [], { ...basic, object_otu_id: 737324 }, new Map(),
    new Map([['737324', { ...combinationOtu, accepted_otu_id: null }]])
  )

  assert.equal(ba.objectAcceptedNameHtml, '<i>Convolvulus sepium</i> R.Br.')
  assert.equal(ba.objectAcceptedOtuId, null)
})

test('a valid name gets no accepted-name suffix', () => {
  const otu = {
    id: 1383723,
    taxon_name_id: 1583501,
    taxon_name: { id: 1583501, cached: 'Dianthus carthusianorum', cached_valid_taxon_name_id: 1583501 }
  }
  const ba = makeBiologicalAssociation(
    baseData, [], [], [], basic, new Map(), new Map([['1383723', otu]])
  )

  assert.equal(ba.objectSpeciesHtml, '<i>Dianthus carthusianorum</i> L.')
  assert.equal(ba.objectAcceptedNameHtml, null)
  assert.equal(ba.objectAcceptedOtuId, null)
})

test('a bare-genus determination still reads "sp.", without the genus authorship', () => {
  const data = {
    ...baseData,
    object: {
      base_class: 'Otu',
      id: 1,
      object_tag: '<span class="otu_tag"><i>Promecops</i> Sahlberg, 1823</span>',
      object_label: 'Promecops Sahlberg, 1823'
    }
  }
  const ba = makeBiologicalAssociation(data, [], [], [], basic, new Map())

  assert.equal(ba.objectSpeciesHtml, '<i>Promecops</i> sp.')
})

test('square brackets inside a name survive; only a trailing "[c]" is dropped', () => {
  const data = {
    ...baseData,
    object: {
      base_class: 'Otu',
      id: 708238,
      object_tag: '<span class="otu_tag">Basitropidini [sic] Lacordaire, 1866</span>',
      object_label: 'Basitropidini [sic] Lacordaire, 1866'
    }
  }
  const ba = makeBiologicalAssociation(data, [], [], [], basic, new Map())

  assert.equal(ba.objectSpeciesHtml, 'Basitropidini [sic] Lacordaire, 1866')
})

test('an OTU with a label and no TaxonName keeps its bold name', () => {
  const data = {
    ...baseData,
    object: {
      base_class: 'Otu',
      id: 736512,
      object_tag: '<span class="otu_tag"><b>Mentha x piperita</b></span>',
      object_label: 'Mentha x piperita'
    }
  }
  const ba = makeBiologicalAssociation(
    data, [], [], [], { ...basic, object_otu_id: 736512 }, new Map(),
    new Map([['736512', { id: 736512, taxon_name_id: null, name: 'Mentha x piperita' }]])
  )

  assert.equal(ba.objectSpeciesHtml, '<b>Mentha x piperita</b>')
  assert.equal(ba.objectHasTaxonName, false)
  assert.equal(ba.objectAcceptedNameHtml, null)
})

test('a "now" tail that repeats the name it follows is dropped, resolved or not', () => {
  // OTU 736049: the TaxonName is valid, so nothing resolves an accepted name —
  // TaxonWorks still writes "X now X" into the tag.
  const data = {
    ...baseData,
    object: {
      base_class: 'Otu',
      id: 736049,
      object_tag: '<span class="otu_tag"><i>Cytisus scoparius</i> Wimm. ex W.D.J.Koch <em>now</em> <i>Cytisus scoparius</i> Wimm. ex W.D.J.Koch</span>',
      object_label: 'Cytisus scoparius Wimm. ex W.D.J.Koch now Cytisus scoparius Wimm. ex W.D.J.Koch'
    }
  }
  const ba = makeBiologicalAssociation(data, [], [], [], { ...basic, object_otu_id: 736049 })

  assert.equal(ba.objectSpeciesHtml, '<i>Cytisus scoparius</i> Wimm. ex W.D.J.Koch')
  assert.equal(ba.objectAcceptedNameHtml, null)
})

test('a repeated "now" tail carrying the OTU label is dropped down to the taxon name', () => {
  // OTU 737745: "<i>name</i> author&nbsp;<b>otu label</b>" on both sides of "now".
  const data = {
    ...baseData,
    object: {
      base_class: 'Otu',
      id: 737745,
      object_tag: '<span class="otu_tag"><i>Lycopsis orientalis</i> Rchb.fil.&nbsp;<b>Anchusa orientalis</b> <em>now</em> <i>Lycopsis orientalis</i> Rchb.fil.&nbsp;<b>Anchusa orientalis</b></span>',
      object_label: 'Lycopsis orientalis Rchb.fil.'
    }
  }
  const ba = makeBiologicalAssociation(data, [], [], [], { ...basic, object_otu_id: 737745 })

  assert.equal(ba.objectSpeciesHtml, '<i>Lycopsis orientalis</i> Rchb.fil.')
})
