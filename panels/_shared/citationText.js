/**
 * citationText.js
 *
 * Small text helpers for displaying a /citations row's `citation_source_body`
 * as a short, clickable label — the full text (or, better, `source.cached`)
 * belongs in ./ReferenceModal.vue, one click away.
 *
 * Depended on by:
 *   - ./DwcTable.vue
 *   - ./ImageLightbox.vue
 *   - ../PanelAssertedDistributions/PanelAssertedDistributions.vue
 *   - ../PanelBiologicalAssociationsV2/PanelBiologicalAssociationsV2.vue
 *   - ../PanelBiologicalAssociationsV2/loadAdvancedAssociations.js
 *   - ../PanelMapV2/components/MapPopup.vue
 *   - ../../modules/keys/KeyView.vue
 *
 * If you change this file, sanity-check all seven call sites.
 */

/**
 * citation_source_body can carry an inline topic annotation as raw markup
 * (e.g. a "Distribution" pill: `<span class="annotation__citation_topic">...`).
 * Strip it before using the string as a plain-text button label — the full,
 * unstripped text (rendered via v-html) belongs in the reference modal.
 * @param {string} s
 * @returns {string}
 */
export function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, '')
}

/**
 * "Author, Other, Another & Last, 2020:12" -> "Author et al., 2020:12", and
 * "Author & Other, 1964" -> "Author et al., 1964".
 * Every multi-author citation is shortened; the "&" is what marks one as
 * multi-author. A single author, or a body that doesn't parse as "…, YEAR"
 * at all (a collector name out of the /basic index, say), is returned
 * unchanged.
 * @param {string} body
 * @returns {string}
 */
export function shortCitation(body) {
  if (!body) return ''
  const m = body.match(/,\s*(\d{4}[a-z]?(?::[^\s,]+)?)\s*$/)
  if (!m) return body
  const year = m[1]
  const authorsStr = body.slice(0, m.index)
  if (!authorsStr.includes('&')) return body
  // Split on whichever separator comes first: "A, B & C" and "A & B" both
  // have to yield "A".
  return `${authorsStr.split(/[,&]/)[0].trim()} et al., ${year}`
}
