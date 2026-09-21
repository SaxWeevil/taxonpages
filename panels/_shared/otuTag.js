/**
 * otuTag.js
 *
 * Extracts the name markup out of a TaxonWorks object_tag string, already
 * italicized by TaxonWorks (e.g. "<i>Hypera</i> (<i>Kippenbergia</i>)
 * <i>miles</i> (Paykull, 1792)"), no separate taxonomy lookup needed.
 *
 * Two markup shapes have to be handled:
 *
 *   - the plain wrapper the API sends today:
 *     <span class="otu_tag"><i>Calystegia sepium</i> [c]</span>
 *   - the older inner otu_tag_taxon_name / otu_tag_otu_name span, which put
 *     the name in its own element and left a trailing valid-name marker
 *     (a ✓/❌ tag) outside it. Still matched first, so the marker keeps being
 *     excluded if TaxonWorks ever emits that shape again.
 *
 * The plain fallback has to match `otu_tag` exactly: `otu_tag` is a prefix of
 * `otu_tag_taxon_name`, so a loose pattern would match the outer span of the
 * nested shape and then stop at the *inner* `</span>`, cutting the name in half.
 * `[^>]*>` after the class attribute tolerates the span's other attributes
 * (title=…); the otu_name alternative covers name-only OTUs with no linked
 * taxon name.
 *
 * Depended on by:
 *   - ../PanelBiologicalAssociationsV2/makeBiologicalAssociation.js (drops
 *     TaxonWorks' "[c]" combination marker and reduces a bare-genus
 *     determination to "<i>Genus</i> sp.", a deliberately different name policy)
 *   - ../../modules/keys/KeysIndex.vue (uses the raw result verbatim,
 *     author-year kept, no "sp.", a deliberately different name policy)
 *
 * If you change this file, sanity-check both call sites.
 *
 * @param {string} objectTag
 * @returns {string|null}
 */
export function extractOtuTagSpan(objectTag) {
  if (!objectTag) return null
  const tag = String(objectTag)
  const inner = tag.match(/otu_tag_(?:taxon_name|otu_name)[^>]*>([\s\S]*?)<\/span>/)
  const m = inner || tag.match(/class="otu_tag"[^>]*>([\s\S]*?)<\/span>/)
  return m ? m[1].trim() || null : null
}
