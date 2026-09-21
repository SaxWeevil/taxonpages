import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readBrowserSession, writeBrowserSession } from './browserSessionStorage.js'
import {
  DEFAULT_VIEW_MODE,
  VIEW_MODES,
  VIEW_MODE_LABELS,
  readViewMode,
  writeViewMode
} from './viewModePreference.js'

// The same fake the Advanced column settings are tested against: a cookie jar,
// a localStorage and the crypto the session id comes from.
function fakeBrowser() {
  const values = new Map()
  return {
    document: { cookie: '' },
    location: { protocol: 'https:' },
    crypto: { randomUUID: () => 'session-1' },
    localStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }
  }
}

test('every view the buttons offer has a label, and the Field Assistant comes first', () => {
  assert.deepEqual(VIEW_MODES, ['standard', 'advanced', 'expert'])
  assert.deepEqual(VIEW_MODES.map(mode => VIEW_MODE_LABELS[mode]),
    ['Field Assistant', 'Advanced', 'Raw data'])
  assert.equal(DEFAULT_VIEW_MODE, 'standard')
  // Frozen: the buttons render straight from this list.
  assert.throws(() => { VIEW_MODES.push('other') })
})

test('a chosen view is read back by the next page and the next tab', () => {
  const browser = fakeBrowser()
  assert.equal(readViewMode(browser), 'standard')

  writeViewMode('advanced', browser)
  assert.equal(readViewMode(browser), 'advanced')
  // A new tab in the same browser session carries the same cookie, so the
  // stored preference is the one it reads.
  assert.equal(readViewMode({ ...browser }), 'advanced')

  writeViewMode('expert', browser)
  assert.equal(readViewMode(browser), 'expert')
})

test('the preference dies with the browser session, like the column settings', () => {
  const browser = fakeBrowser()
  writeViewMode('expert', browser)
  browser.document.cookie = ''
  assert.equal(readViewMode(browser), 'standard')
})

test('a view this panel no longer has falls back to the Field Assistant', () => {
  const key = 'taxonpages:biological-associations:view'
  const browser = fakeBrowser()
  writeBrowserSession(key, 'summary', browser)
  assert.equal(readViewMode(browser), 'standard')

  // And a mode outside the list never reaches storage, so it cannot overwrite
  // a view that is still valid.
  writeViewMode('advanced', browser)
  writeViewMode('summary', browser)
  assert.equal(readBrowserSession(key, browser), 'advanced')
})

test('blocked storage leaves the panel on its default rather than throwing', () => {
  const blocked = {
    document: { get cookie() { throw new Error('blocked') }, set cookie(value) { throw new Error('blocked') } },
    localStorage: { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }
  }
  assert.equal(readViewMode(blocked), 'standard')
  assert.doesNotThrow(() => writeViewMode('advanced', blocked))
  assert.equal(readViewMode({}), 'standard')
})
