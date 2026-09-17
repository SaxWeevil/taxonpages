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
