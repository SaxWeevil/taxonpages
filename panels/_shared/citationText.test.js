import assert from 'node:assert/strict'
import { test } from 'node:test'
import { shortCitation, stripHtml } from './citationText.js'

test('a multi-author citation reads "First et al., Year" from two authors up', () => {
  assert.equal(shortCitation('Dieckmann & Scherf, 1964'), 'Dieckmann et al., 1964')
  assert.equal(shortCitation('Blatchley & Leng, 1916:127'), 'Blatchley et al., 1916:127')
  assert.equal(shortCitation('Meregalli, Borovec & Colonnelli, 2013'), 'Meregalli et al., 2013')
  assert.equal(shortCitation('Girón, O’Brien & Rose-Smith, 2018:22'), 'Girón et al., 2018:22')
  // A year suffix is part of the year, not of the page reference.
  assert.equal(shortCitation('Lanteri, Marvaldi & Suárez, 2002a'), 'Lanteri et al., 2002a')
})

test('a single author is left alone', () => {
  assert.equal(shortCitation('Scherf, 1964'), 'Scherf, 1964')
  assert.equal(shortCitation('Dieckmann, 1989a'), 'Dieckmann, 1989a')
  assert.equal(shortCitation('Scherf, 1964:12'), 'Scherf, 1964:12')
})

test('anything that does not end in a year is returned untouched', () => {
  // Collector and determiner names arrive in the very same column.
  assert.equal(shortCitation('Schirok, Tristan'), 'Schirok, Tristan')
  assert.equal(shortCitation('© 2018 Katja Schulz'), '© 2018 Katja Schulz')
  // A long author list with no year has nothing to anchor the shortening on.
  const noYear = 'Krátký, Sprick, Winkelmann, Stejskal & Behne'
  assert.equal(shortCitation(noYear), noYear)
  assert.equal(shortCitation(''), '')
  assert.equal(shortCitation(null), '')
})

test('stripHtml drops the inline topic annotation', () => {
  assert.equal(stripHtml('<span class="annotation__citation_topic">Distribution</span>Scherf, 1964'),
    'DistributionScherf, 1964')
  assert.equal(stripHtml(null), '')
})
