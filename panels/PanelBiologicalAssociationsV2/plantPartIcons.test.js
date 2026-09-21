import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import test from 'node:test'
import {
  PLANT_ONTOLOGY_RELEASE,
  plantPartDisplay,
  uniquePlantParts
} from './plantPartIcons.js'

test('maps the inventoried plant terms to curated PO icon groups', () => {
  const display = plantPartDisplay([
    'leaf', 'petiole', 'leaf axil', 'leaf epidermis', 'stipule', 'leaflet tendril',
    'flower', 'inflorescence', 'plant ovary',
    'stem', 'shoot axis', 'stem base',
    'root'
  ])

  assert.deepEqual(display.icons.map(icon => icon.key), ['leaf', 'flower', 'stem', 'root'])
  assert.deepEqual(display.icons[0].hints, ['axil', 'tendril'])
  assert.deepEqual(display.icons[2].hints, ['base'])
  assert.deepEqual(display.fallback, [])
  assert.equal(PLANT_ONTOLOGY_RELEASE, 'releases/2026-01-09')
})

test('maps both bud terms to the one bud icon', () => {
  const display = plantPartDisplay(['bud', 'flower bud'])

  assert.deepEqual(display.icons.map(icon => icon.key), ['bud'])
  assert.deepEqual(display.icons[0].poIds, ['PO:0000055', 'PO:0000056'])
  assert.deepEqual(display.fallback, [])
  for (const icon of display.icons) {
    assert.equal(existsSync(new URL(`../../public${icon.src}`, import.meta.url)), true)
  }
})

test('"on plant" no longer earns a symbol of its own', () => {
  // Every row of this table is about a plant, so a whole-plant silhouette said
  // nothing. The grouping stopped producing the term; should one reach here
  // anyway it stays text rather than picking up a wrong organ's picture.
  const display = plantPartDisplay(['on plant'])

  assert.deepEqual(display.icons, [])
  assert.deepEqual(display.fallback, ['on plant'])
})

test('collects unique terms from only the currently supplied rows', () => {
  const rows = [
    { parts: ['leaf', 'bud', 'leaf'] },
    { parts: [' stem base ', 'bud'] },
    { parts: [] }
  ]

  assert.deepEqual(uniquePlantParts(rows), ['bud', 'leaf', 'stem base'])
  assert.deepEqual(uniquePlantParts(rows.slice(0, 1)), ['bud', 'leaf'])
})

test('combines fruit and seed into the confirmed shared project icon', () => {
  const display = plantPartDisplay(['fruit', 'seed'])

  assert.deepEqual(display.icons.map(icon => icon.key), ['fruit-seed'])
  assert.deepEqual(display.icons[0].poIds, ['PO:0009001', 'PO:0009010'])
  assert.equal(display.notes.length, 1)
})

test('keeps original terms and unmapped parts available as text', () => {
  const display = plantPartDisplay(['leaf', 'bud', 'unknown tissue'])

  assert.deepEqual(display.icons.map(icon => icon.key), ['leaf', 'bud'])
  assert.deepEqual(display.fallback, ['unknown tissue'])
  assert.deepEqual(display.originals, ['bud', 'leaf', 'unknown tissue'])
})

test('explains the intentional rhizome simplification', () => {
  const display = plantPartDisplay(['rhizome'])

  assert.deepEqual(display.icons.map(icon => icon.key), ['root'])
  assert.deepEqual(display.icons[0].hints, ['rhizome'])
  assert.match(display.notes[0], /underground shoot axis/)
})
