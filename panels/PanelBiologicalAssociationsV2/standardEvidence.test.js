import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyStandardRow,
  filterStandardRows,
  isStandardVisible,
  standardMark,
  standardRowMark,
  subjectStage
} from './standardEvidence.js'

// Real /basic participant shapes: `type` + `label`, the AnatomicalPart term
// sitting in front of ': '.
const otu = (label = 'Hypera (Kippenbergia) arator (Linnaeus, 1758)') =>
  ({ id: 732584, type: 'Otu', family: 'Curculionidae', label })
const stagePart = term => ({ id: 95, type: 'AnatomicalPart', family: 'Curculionidae', label: `${term}: Hypera arator` })
const row = (subject, relationship) => ({
  id: 1, subject, relationship,
  object: { id: 1383723, type: 'Otu', family: 'Caryophyllaceae', label: 'Dianthus carthusianorum L.' }
})

test('every immature stage counts, whatever the relationship says', () => {
  for (const term of ['egg', 'larvae', 'pupa', 'nidus']) {
    assert.equal(classifyStandardRow(row(stagePart(term), '[legacy] feeds on')), 'stage')
    assert.equal(classifyStandardRow(row(stagePart(term), 'undefined relationship with')), 'stage')
  }
  // Rule 1 wins over the relationship rules: a larva collected from a plant is
  // stage evidence, not a weak adult record, and a reared larva stays 'stage'
  // so the row still says which rule admitted it.
  assert.equal(classifyStandardRow(row(stagePart('larvae'), 'collected from')), 'stage')
  assert.equal(standardRowMark(row(stagePart('larvae'), 'collected from')), 'confirmed')
  assert.equal(classifyStandardRow(row(stagePart('larvae'), 'reared from')), 'stage')
})

test('a stage term is read case- and whitespace-insensitively', () => {
  assert.equal(subjectStage(row(stagePart('Larvae'), 'collected from')), 'larvae')
  assert.equal(subjectStage(row(stagePart(' Pupa '), 'collected from')), 'pupa')
  assert.equal(classifyStandardRow(row(stagePart('EGG'), '[legacy] feeds on')), 'stage')
  assert.equal(classifyStandardRow(row(stagePart(' Adult '), ' collected from ')), 'collected-from')
})

test('an adult or partless subject needs the relationship to qualify', () => {
  for (const subject of [otu(), stagePart('adult')]) {
    assert.equal(classifyStandardRow(row(subject, 'feeding observed in the wild on')), 'wild-feeding')
    assert.equal(classifyStandardRow(row(subject, 'collected from')), 'collected-from')
    // Rearing proves the host carried the development -- stronger than a find
    // on the plant, which is already visible as weak evidence.
    assert.equal(classifyStandardRow(row(subject, 'reared from')), 'reared')
    assert.equal(classifyStandardRow(row(subject, 'feeding observed in experimental setup on')), 'other')
    assert.equal(classifyStandardRow(row(subject, '[legacy] feeds on')), 'other')
    assert.equal(classifyStandardRow(row(subject, 'undefined relationship with')), 'other')
  }
})

test('a specimen subject without an anatomical part is treated as partless', () => {
  const specimen = { id: 5000, type: 'FieldOccurrence', label: 'FieldOccurrence 5000; uuid; Germany' }
  assert.equal(subjectStage(row(specimen, 'collected from')), '')
  assert.equal(classifyStandardRow(row(specimen, 'collected from')), 'collected-from')
})

test('an unknown or unreadable anatomical part never passes as adult', () => {
  // A plant organ recorded on the subject side, and an AnatomicalPart whose
  // term cannot be read, are both unknown -- not "no part at all".
  assert.equal(classifyStandardRow(row(stagePart('leaf'), 'collected from')), 'other')
  const unnamed = { id: 95, type: 'AnatomicalPart', label: 'Hypera arator' }
  assert.equal(subjectStage(row(unnamed, 'collected from')), null)
  assert.equal(classifyStandardRow(row(unnamed, 'collected from')), 'other')
  assert.equal(classifyStandardRow(row(unnamed, 'feeding observed in the wild on')), 'other')
})

test('an object-side anatomical part says nothing about the subject', () => {
  const record = row(otu(), '[legacy] feeds on')
  record.object = { id: 96, type: 'AnatomicalPart', label: 'leaf: Dianthus carthusianorum L.' }
  assert.equal(classifyStandardRow(record), 'other')
})

test('marks group stage, rearing and wild feeding together', () => {
  assert.equal(standardMark('stage'), 'confirmed')
  assert.equal(standardMark('wild-feeding'), 'confirmed')
  assert.equal(standardMark('reared'), 'confirmed')
  assert.equal(standardMark('collected-from'), 'weak')
  assert.equal(standardMark('other'), 'excluded')
  assert.equal(standardMark('nonsense'), 'excluded')
})

test('filtering keeps the confirmed categories only, until the switch is on', () => {
  const rows = [
    row(stagePart('egg'), '[legacy] feeds on'),
    row(otu(), 'feeding observed in the wild on'),
    row(otu(), 'collected from'),
    row(otu(), 'reared from'),
    row(otu(), '[legacy] feeds on')
  ]
  // `collected from` is uncertain evidence: hidden with the excluded row, not
  // shown next to the confirmed ones.
  assert.deepEqual(rows.map(isStandardVisible), [true, true, false, true, false])
  assert.equal(filterStandardRows(rows).length, 3)
  assert.equal(filterStandardRows(rows, true).length, 5)
  // A copy, never the caller's array.
  assert.notEqual(filterStandardRows(rows, true), rows)
})

test('a missing subject or relationship falls to other rather than throwing', () => {
  assert.equal(classifyStandardRow({}), 'other')
  assert.equal(classifyStandardRow(undefined), 'other')
  assert.equal(subjectStage(undefined), '')
})
