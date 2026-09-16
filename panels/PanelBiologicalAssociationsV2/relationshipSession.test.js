import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readSessionRelationshipPreferences, selectedRelationshipsForOptions, writeSessionRelationshipPreferences } from './relationshipPreferences.js'
import { defaultAdvancedSettings, filterAdvancedRows } from './advancedAssociations.js'

test('Standard defaults exclude legacy and undefined while Advanced independently includes all relationships', () => {
  const options = ['reared from', 'collected from', '[legacy] feeds on', 'LEGACY host', 'undefined relationship with']
  assert.deepEqual(selectedRelationshipsForOptions(options), ['reared from', 'collected from'])
  const rows = options.map((relationship, id) => ({ id, relationship }))
  assert.equal(filterAdvancedRows(rows, defaultAdvancedSettings()).length, options.length)
  assert.ok(selectedRelationshipsForOptions(options, { 'undefined relationship with': true }).includes('undefined relationship with'))
  assert.deepEqual(selectedRelationshipsForOptions(options), ['reared from', 'collected from'])
})

test('new tabs inherit choices; a new browser session ignores retained storage', () => {
  const storage = new Map()
  const browser = {
    document: { cookie: '' },
    crypto: { randomUUID: () => 'session-one' },
    location: { protocol: 'https:' },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value)
    }
  }
  const preferences = { 'reared from': true, 'collected from': false }
  writeSessionRelationshipPreferences(preferences, browser)
  assert.ok(!/expires|max-age/i.test(browser.document.cookie))
  const tab = { ...browser, document: { cookie: browser.document.cookie.split(';')[0] } }
  assert.deepEqual(readSessionRelationshipPreferences(tab), preferences)
  tab.document.cookie = ''
  assert.deepEqual(readSessionRelationshipPreferences(tab), {})
  tab.document.cookie = 'taxonpages_relationship_session=another-session'
  assert.deepEqual(readSessionRelationshipPreferences(tab), {})
})

test('unavailable storage does not break the panel', () => {
  assert.deepEqual(readSessionRelationshipPreferences({}), {})
  assert.doesNotThrow(() => writeSessionRelationshipPreferences({}, {}))
})
