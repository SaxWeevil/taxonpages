/**
 * standardEvidence.js
 *
 * Classifies a /biological_associations/basic row for the Standard view.
 *
 * Standard is the field view: it answers "where is it worth looking for this
 * beetle?", so by default it shows only confirmed evidence -- developmental
 * stages, rearings and wild feeding observations. Everything weaker stays
 * behind the "show uncertain records" switch: being `collected from` a plant
 * (amber) as well as the 2726 `[legacy] feeds on` rows that carry neither a
 * stage nor an organ (red). The switch widens the view to both at once.
 *
 * Pure module: no Vue, no HTTP. The classification reads the SUBJECT side,
 * which biological-association data models as the animal on either page
 * direction (a plant page still has the beetle as subject).
 */

import { anatomicalPartName } from './makeBiologicalAssociation.js'

/** Immature stages and the nest a specimen was taken from. */
export const STAGE_PARTS = Object.freeze(['egg', 'larvae', 'pupa', 'nidus'])
/** An adult, or no anatomical part at all -- these need the relationship. */
export const ADULT_PARTS = Object.freeze(['adult', ''])
export const WILD_FEEDING_RELATIONSHIP = 'feeding observed in the wild on'
/** Rearing shows the host carried the development, not just the adult. */
export const REARED_FROM_RELATIONSHIP = 'reared from'
export const COLLECTED_FROM_RELATIONSHIP = 'collected from'

/**
 * '' when the subject carries no AnatomicalPart, the lowercased term when it
 * does, and null for an AnatomicalPart whose term cannot be read -- which is
 * not the same as having none, and must not pass as "adult or empty".
 */
export function subjectStage(row) {
  const subject = row?.subject || {}
  if ((subject.type || subject.base_class) !== 'AnatomicalPart') return ''
  return anatomicalPartName(subject)?.trim().toLocaleLowerCase('en') || null
}

/**
 * 'stage'          egg/larvae/pupa/nidus, whatever the relationship says
 * 'wild-feeding'   adult or no part + feeding observed in the wild on
 * 'reared'         adult or no part + reared from
 * 'collected-from' adult or no part + collected from (weak evidence)
 * 'other'          everything else -- hidden unless the switch is on
 */
export function classifyStandardRow(row) {
  const stage = subjectStage(row)
  if (STAGE_PARTS.includes(stage)) return 'stage'
  if (ADULT_PARTS.includes(stage)) {
    const relationship = row?.relationship?.trim?.() || ''
    if (relationship === WILD_FEEDING_RELATIONSHIP) return 'wild-feeding'
    if (relationship === REARED_FROM_RELATIONSHIP) return 'reared'
    if (relationship === COLLECTED_FROM_RELATIONSHIP) return 'collected-from'
  }
  return 'other'
}

// Stage, rearing and wild feeding share one mark: each of them ties the beetle
// to that host directly, and the dot says how much a record is worth in the
// field, not which rule admitted it. Being collected from a plant does not --
// hence the separate weak mark, which is uncertain evidence and therefore
// hidden with the excluded rows until the switch is on.
const MARK_BY_CATEGORY = Object.freeze({
  stage: 'confirmed',
  'wild-feeding': 'confirmed',
  reared: 'confirmed',
  'collected-from': 'weak',
  other: 'excluded'
})

export function standardMark(category) {
  return MARK_BY_CATEGORY[category] || 'excluded'
}

export function standardRowMark(row) {
  return standardMark(classifyStandardRow(row))
}

/** Confirmed evidence only -- a `collected from` adult is uncertain and waits
 *  for the switch, together with everything outside the criteria. */
export function isStandardVisible(row) {
  return standardRowMark(row) === 'confirmed'
}

export function filterStandardRows(rows = [], showUncertainRecords = false) {
  return showUncertainRecords ? [...rows] : rows.filter(isStandardVisible)
}

export function emptyStandardCounts() {
  return { confirmed: 0, weak: 0, excluded: 0 }
}

/**
 * Green, amber and red, in the fixed slot order the Standard table renders.
 * Lives here, not in the table's <script setup>, so the column-heading legend
 * and the per-row breakdown can never drift apart: both read this one list.
 */
export const STANDARD_MARK_STYLES = Object.freeze([
  Object.freeze({
    key: 'confirmed',
    class: 'text-success',
    reason: 'immature stage, or adult reared from or feeding observed in the wild'
  }),
  Object.freeze({
    key: 'weak',
    class: 'text-warning',
    reason: 'adult collected from'
  }),
  Object.freeze({
    key: 'excluded',
    class: 'text-danger',
    reason: 'vague relationships of adults: legacy, feeding observed in experimental setup and undefined relationship'
  })
])

/** All three slots, always, in a fixed order -- a row that only has red must
 *  not put its dot where its neighbour's green one sits. */
export function standardRowMarks(row) {
  const counts = row?.counts || {}
  const total = Number(row?.count) || 0
  return STANDARD_MARK_STYLES.map(mark => {
    const count = counts[mark.key] || 0
    return { ...mark, count, title: `${count} of ${total} records: ${mark.reason}` }
  })
}

/** Only the categories the row actually has -- an empty slot reserves space in
 *  the table, but listing "0 of 11" in the breakdown is noise. */
export function standardRowMarkLines(row) {
  return standardRowMarks(row).filter(mark => mark.count)
}

/**
 * The whole breakdown as one string. It is the accessible name of the dot
 * group's button, so a screen-reader user hears every share without opening
 * the popover -- which on touch is the only way in at all.
 */
export function standardMarksLabel(row) {
  const name = row?.name || 'this taxon'
  const lines = standardRowMarkLines(row)
  return lines.length
    ? `Evidence for ${name}: ${lines.map(mark => mark.title).join('; ')}`
    : `Evidence for ${name}: no records classified`
}
