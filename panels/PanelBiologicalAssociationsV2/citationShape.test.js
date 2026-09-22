import assert from 'node:assert/strict'
import { test } from 'node:test'
import { shapeCitation } from './citationShape.js'

test('shapes a multi-author citation to "First et al., Year" for short, keeps the body for full', () => {
  const row = { id: 1, citation_source_body: 'Smith, Jones & Lee, 2020:12' }
  assert.deepEqual(shapeCitation(row), {
    id: 1, short: 'Smith et al., 2020:12', full: 'Smith, Jones & Lee, 2020:12'
  })
})

test('leaves a single-author citation unchanged', () => {
  const row = { id: 2, citation_source_body: 'Smith, 2020' }
  assert.equal(shapeCitation(row).short, 'Smith, 2020')
})

test('short strips inline HTML annotations; full is left raw for v-html', () => {
  const body = 'Smith & Jones, 2020 <span class="annotation__citation_topic">Distribution</span>'
  const result = shapeCitation({ id: 3, citation_source_body: body })
  assert.ok(!result.short.includes('<'))
  assert.equal(result.full, body)
})

test('prefers source.cached for full, falling back to the citation body', () => {
  const withSource = shapeCitation({
    id: 4, citation_source_body: 'Smith, 2020', source: { cached: 'Smith, A. (2020). Full reference.' }
  })
  assert.equal(withSource.full, 'Smith, A. (2020). Full reference.')

  const withoutSource = shapeCitation({ id: 5, citation_source_body: 'Smith, 2020' })
  assert.equal(withoutSource.full, 'Smith, 2020')
})

test('a row with no citation text shapes to empty strings, not undefined', () => {
  assert.deepEqual(shapeCitation({ id: 6 }), { id: 6, short: '', full: '' })
})
