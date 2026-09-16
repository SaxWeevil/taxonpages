import assert from 'node:assert/strict'
import { test } from 'node:test'
import { copyTableSelection, tableClipboardData } from './tableClipboard.js'

test('clipboard HTML escapes taxon labels and embedded whitespace cannot create cells', () => {
  const { text, html } = tableClipboardData([['leaf\nstem', '<name & "label">', 'a\tb']])
  assert.equal(text, 'leaf stem\t<name & "label">\ta b')
  assert.ok(html.includes('&lt;name &amp; &quot;label&quot;&gt;'))
})

test('native copy is untouched outside the table or for ordinary text selections', () => {
  const range = { startContainer: {}, endContainer: {}, intersectsNode: () => false }
  const table = { contains: () => false, querySelectorAll: () => [] }
  const root = {
    ownerDocument: { getSelection: () => ({ rangeCount: 1, getRangeAt: () => range }) },
    querySelector: () => table
  }
  const event = { clipboardData: { setData: () => assert.fail('native copy should remain untouched') },
    preventDefault: () => assert.fail('native copy should remain untouched') }
  copyTableSelection(event, root)
  table.contains = () => true
  copyTableSelection(event, root)
})
