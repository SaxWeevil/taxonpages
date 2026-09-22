/**
 * citationShape.js
 *
 * Shapes one raw TaxonWorks /citations row into the { id, short, full } form
 * every citation display in this panel reads. `full` is what ReferenceModal
 * binds to — a differently-named key here once left the Raw data modal
 * empty, so keep it exactly `full`.
 *
 * Depended on by:
 *   - PanelBiologicalAssociationsV2.vue (fetchCitations, fetchLegacyCitations)
 *   - loadAdvancedAssociations.js (citationEntry, used by Advanced)
 *
 * If you change this file, sanity-check both call sites.
 */
import { shortCitation, stripHtml } from '../_shared/citationText.js'

/**
 * @param {object} row - a /citations row, or an equivalent shape with
 *   `id`, `citation_source_body` and an inlined `source` (either from
 *   `extend[]=source` directly, or resolved separately and merged in).
 */
export function shapeCitation(row) {
  return {
    id: row.id,
    // Two or more authors collapse to "First et al., Year"; a single author
    // is left alone. Plain text, so the filter list, the sort key and the
    // clipboard all read like the cell.
    short: shortCitation(stripHtml(row.citation_source_body || '')),
    // The full reference for the modal; only needed when TaxonWorks did not
    // render one. The unshortened body is the last resort so a
    // non-bibliographic source never loses its author list.
    full: row.source?.cached || row.citation_source_body || ''
  }
}
