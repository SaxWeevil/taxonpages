import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractOtuTagSpan } from './otuTag.js'

test('extractOtuTagSpan: extracts inner HTML of an otu_tag_taxon_name span', () => {
  const tag = '<span class="otu_tag_taxon_name" title="x"><i>Hypera</i> (<i>Kippenbergia</i>) <i>arator</i> (Linnaeus, 1758)</span> <span>&#10003;</span>'
  assert.equal(
    extractOtuTagSpan(tag),
    '<i>Hypera</i> (<i>Kippenbergia</i>) <i>arator</i> (Linnaeus, 1758)'
  )
})

test('extractOtuTagSpan: extracts inner HTML of an otu_tag_otu_name span', () => {
  const tag = '<span class="otu_tag_otu_name">Brentidae (except Nanophyinae)</span>'
  assert.equal(extractOtuTagSpan(tag), 'Brentidae (except Nanophyinae)')
})

test('extractOtuTagSpan: excludes a trailing valid-name marker outside the span', () => {
  const tag = '<span class="otu_tag_taxon_name"><i>Dianthus carthusianorum</i> L.</span>&#10003;'
  assert.equal(extractOtuTagSpan(tag), '<i>Dianthus carthusianorum</i> L.')
})

test('extractOtuTagSpan: no matching span -> null', () => {
  assert.equal(extractOtuTagSpan('<span class="something_else">x</span>'), null)
})

test('extractOtuTagSpan: null/empty input -> null', () => {
  assert.equal(extractOtuTagSpan(null), null)
  assert.equal(extractOtuTagSpan(''), null)
})

// The markup the API actually sends today — a plain otu_tag wrapper, no inner
// span. Verified against /otus/:id, /otus?otu_id[]= and
// /biological_associations?extend[]=object (2026-09-21).
test('extractOtuTagSpan: extracts inner HTML of a plain otu_tag span', () => {
  const tag = '<span class="otu_tag"><i>Mentha aquatica</i> L.</span>'
  assert.equal(extractOtuTagSpan(tag), '<i>Mentha aquatica</i> L.')
})

test('extractOtuTagSpan: keeps TaxonWorks\' own "now" tail of a synonym OTU', () => {
  const tag = '<span class="otu_tag"><i>Brachytarsus</i> Schönherr, 1823 <em>now</em> <i>Anthribus</i> Geoffroy, 1762</span>'
  assert.equal(
    extractOtuTagSpan(tag),
    '<i>Brachytarsus</i> Schönherr, 1823 <em>now</em> <i>Anthribus</i> Geoffroy, 1762'
  )
})

test('extractOtuTagSpan: keeps the combination marker for the caller to drop', () => {
  const tag = '<span class="otu_tag"><i>Calystegia sepium</i> [c]</span>'
  assert.equal(extractOtuTagSpan(tag), '<i>Calystegia sepium</i> [c]')
})

test('extractOtuTagSpan: the plain fallback never cuts a nested span in half', () => {
  const tag = '<span class="otu_tag"><span class="otu_tag_taxon_name"><i>Dianthus carthusianorum</i> L.</span>&#10003;</span>'
  assert.equal(extractOtuTagSpan(tag), '<i>Dianthus carthusianorum</i> L.')
})
