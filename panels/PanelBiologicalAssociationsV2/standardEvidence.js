/**
 * standardEvidence.js
 *
 * Classifies a /biological_associations/basic row for the Field Assistant.
 *
 * The Field Assistant answers "where is it worth looking for this beetle?", so
 * it grades rather than filters: every associated taxon is listed, and each one
 * carries the single best mark its records earn -- green for a developmental
 * stage, a rearing or a wild feeding observation, amber for being `collected
 * from` a plant, red for the rest, above all the `[legacy] feeds on` rows that
 * name neither a stage nor an organ. Hiding the weaker ones behind a switch
 * made an absent taxon and a poorly evidenced one look the same; one dot per
 * taxon says which it is at a glance.
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
/**
 * Rearing shows the host carried the development, not just the adult.
 * `reared from galls on` is a relationship of its own in TaxonWorks, not a
 * wording variant, so it is listed rather than matched by prefix -- a prefix
 * would also admit relationships that merely start the same way.
 */
export const REARED_FROM_RELATIONSHIPS = Object.freeze([
  'reared from',
  'reared from galls on'
])
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
 * 'reared'         reared from / reared from galls on, whatever the part says
 * 'wild-feeding'   adult or no part + feeding observed in the wild on
 * 'collected-from' adult or no part + collected from (weak evidence)
 * 'other'          everything else
 */
export function classifyStandardRow(row) {
  const stage = subjectStage(row)
  const relationship = row?.relationship?.trim?.() || ''
  if (STAGE_PARTS.includes(stage)) return 'stage'
  // A rearing needs no part gate: the relationship itself says the host
  // carried the development, so which part the reared specimen was filed
  // under adds nothing. Gating it would hang the colour on a spelling -- the
  // project's own gall rearings are recorded as `larva`, in the singular,
  // which is in neither list. A feeding observation is gated because it
  // describes the individual that was watched, so what that individual was
  // does decide what the record shows.
  if (REARED_FROM_RELATIONSHIPS.includes(relationship)) return 'reared'
  if (ADULT_PARTS.includes(stage)) {
    if (relationship === WILD_FEEDING_RELATIONSHIP) return 'wild-feeding'
    if (relationship === COLLECTED_FROM_RELATIONSHIP) return 'collected-from'
  }
  return 'other'
}

// Stage, rearing and wild feeding share one mark: each of them ties the beetle
// to that host directly, and the dot says how much a record is worth in the
// field, not which rule admitted it. Being collected from a plant does not --
// hence the separate weak mark, one step below it and one above everything
// outside the criteria.
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
    reason: 'immature stage, reared from (including galls), or adult feeding observed in the wild'
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

/** All three categories in a fixed order, each with the row's count. The table
 *  shows only the best of them; the breakdown behind the dot shows the rest. */
export function standardRowMarks(row) {
  const counts = row?.counts || {}
  const total = Number(row?.count) || 0
  return STANDARD_MARK_STYLES.map(mark => {
    const count = counts[mark.key] || 0
    return { ...mark, count, title: `${count} of ${total} records: ${mark.reason}` }
  })
}

/**
 * The single mark the Field Assistant paints for a row: the best category the
 * row has any record in, green before amber before red. That order is
 * STANDARD_MARK_STYLES' own, so the priority cannot drift from the legend.
 * null for a row with nothing classified, which the table then leaves blank
 * rather than inventing a colour for.
 */
export function standardBestMark(row) {
  return standardRowMarks(row).find(mark => mark.count) || null
}

/** Only the categories the row actually has -- listing "0 of 11" in the
 *  breakdown is noise. */
export function standardRowMarkLines(row) {
  return standardRowMarks(row).filter(mark => mark.count)
}

/**
 * The whole breakdown as one string. It is the accessible name of the dot's
 * button, so a screen-reader user hears every share -- not just the best one
 * the dot paints -- without opening the popover, which on touch is the only
 * way in at all.
 */
export function standardMarksLabel(row) {
  const name = row?.name || 'this taxon'
  const lines = standardRowMarkLines(row)
  return lines.length
    ? `Evidence for ${name}: ${lines.map(mark => mark.title).join('; ')}`
    : `Evidence for ${name}: no records classified`
}
