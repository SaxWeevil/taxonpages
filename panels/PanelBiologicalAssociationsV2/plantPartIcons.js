// Dateien aus public/ werden unter Vites base ausgeliefert (config/router.yml
// base_url). Ein absolutes '/images/…' laeuft deshalb ins Leere, sobald die
// Seite in einem Unterpfad liegt (z.B. /taxonpages/). BASE_URL endet immer auf
// '/'; unter node --test gibt es kein import.meta.env, daher der Fallback.
const ASSET_BASE = import.meta.env?.BASE_URL || '/'
const ICON_ROOT = `${ASSET_BASE}images/biological-associations/`
export const PLANT_ONTOLOGY_RELEASE = 'releases/2026-01-09'

const ICONS = Object.freeze({
  wholePlant: {
    key: 'whole-plant',
    // A record without an Object AnatomicalPart names the plant, not an organ.
    // The PO term behind the icon stays "whole plant"; only the wording here
    // says what the data actually asserts.
    label: 'On plant',
    src: `${ICON_ROOT}plant-part-whole-plant.png`
  },
  leaf: {
    key: 'leaf',
    label: 'Leaf',
    src: `${ICON_ROOT}plant-part-leaf.png`
  },
  flower: {
    key: 'flower',
    label: 'Flower',
    src: `${ICON_ROOT}plant-part-flower.png`
  },
  bud: {
    key: 'bud',
    label: 'Bud',
    src: `${ICON_ROOT}plant-part-bud.png`
  },
  stem: {
    key: 'stem',
    label: 'Stem',
    src: `${ICON_ROOT}plant-part-stem.png`
  },
  root: {
    key: 'root',
    label: 'Root',
    src: `${ICON_ROOT}plant-part-root.png`
  },
  fruitSeed: {
    key: 'fruit-seed',
    label: 'Fruit and seed',
    src: `${ICON_ROOT}plant-part-fruit-seed.png`
  }
})

// Curated exact-label mapping from the project PO inventory. These are display
// groups, not additional TaxonWorks fields and not inferred PO relationships.
// Keeping the PO identity here makes each simplification auditable.
const PART_MAPPING = Object.freeze({
  'on plant': { poId: 'PO:0000003', icon: 'wholePlant' },

  leaf: { poId: 'PO:0025034', icon: 'leaf' },
  petiole: { poId: 'PO:0020038', icon: 'leaf' },
  'leaf axil': { poId: 'PO:0009023', icon: 'leaf', hint: 'axil' },
  'leaf epidermis': { poId: 'PO:0006016', icon: 'leaf' },
  stipule: { poId: 'PO:0020041', icon: 'leaf' },
  'leaflet tendril': { poId: 'PO:0025362', icon: 'leaf', hint: 'tendril' },

  flower: { poId: 'PO:0009046', icon: 'flower' },
  inflorescence: { poId: 'PO:0009049', icon: 'flower' },
  'plant ovary': { poId: 'PO:0009072', icon: 'flower' },

  bud: { poId: 'PO:0000055', icon: 'bud' },
  'flower bud': { poId: 'PO:0000056', icon: 'bud' },

  stem: { poId: 'PO:0009047', icon: 'stem' },
  'shoot axis': { poId: 'PO:0025029', icon: 'stem' },
  'stem base': { poId: 'PO:0008039', icon: 'stem', hint: 'base' },

  root: { poId: 'PO:0009005', icon: 'root' },
  rhizome: {
    poId: 'PO:0004542',
    icon: 'root',
    hint: 'rhizome',
    note: 'Rhizome is botanically an underground shoot axis; this simplified field view displays it with root.'
  },

  fruit: {
    poId: 'PO:0009001',
    icon: 'fruitSeed',
    note: 'Fruit and seed are displayed together because the plant class needed for the project distinction is not recorded in TaxonWorks.'
  },
  seed: {
    poId: 'PO:0009010',
    icon: 'fruitSeed',
    note: 'Fruit and seed are displayed together because the plant class needed for the project distinction is not recorded in TaxonWorks.'
  }
})

const ICON_ORDER = ['wholePlant', 'leaf', 'flower', 'bud', 'stem', 'root', 'fruitSeed']
const alphabetical = new Intl.Collator('en', { sensitivity: 'base', numeric: true }).compare

function normalizePart(value) {
  return value?.trim?.().toLocaleLowerCase('en') || ''
}

export function uniquePlantParts(rows = []) {
  return [...new Set(
    rows.flatMap(row => row.parts || [])
      .map(part => part?.trim?.() || '')
      .filter(Boolean)
  )].sort(alphabetical)
}

/**
 * Adds the curated PO display group while preserving every original term.
 * Unmapped values intentionally remain text; a missing icon must not imply a
 * botanically incorrect group.
 */
export function plantPartDisplay(parts = []) {
  const icons = new Map()
  const fallback = new Set()
  const originals = new Set()
  const notes = new Set()

  for (const rawPart of parts) {
    const original = rawPart?.trim?.() || ''
    if (!original) continue
    originals.add(original)

    const mapping = PART_MAPPING[normalizePart(original)]
    if (!mapping) {
      fallback.add(original)
      continue
    }

    const definition = ICONS[mapping.icon]
    if (!icons.has(mapping.icon)) {
      icons.set(mapping.icon, {
        ...definition,
        hints: new Set(),
        originals: new Set(),
        poIds: new Set()
      })
    }
    const icon = icons.get(mapping.icon)
    icon.originals.add(original)
    icon.poIds.add(mapping.poId)
    if (mapping.hint) icon.hints.add(mapping.hint)
    if (mapping.note) notes.add(mapping.note)
  }

  return {
    icons: ICON_ORDER
      .filter(key => icons.has(key))
      .map(key => {
        const icon = icons.get(key)
        const originalValues = [...icon.originals].sort(alphabetical)
        return {
          ...icon,
          hints: [...icon.hints].sort(alphabetical),
          originals: originalValues,
          poIds: [...icon.poIds].sort(alphabetical),
          title: `${icon.label}: ${originalValues.join(', ')}`
        }
      }),
    fallback: [...fallback].sort(alphabetical),
    originals: [...originals].sort(alphabetical),
    notes: [...notes]
  }
}
