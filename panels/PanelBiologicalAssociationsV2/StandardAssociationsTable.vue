<template>
  <div ref="tableRoot">
    <VTable
      class="standard-association-table"
      :style="{ '--standard-count-digits': maxCountDigits }"
    >
      <VTableHeader class="normal-case">
        <VTableHeaderRow>
          <VTableHeaderCell class="standard-col-parts">
            <span class="inline-flex items-center gap-1">
              Anatomical parts
              <PlantPartInfo :parts="visibleParts" data-copy-ignore />
            </span>
          </VTableHeaderCell>
          <VTableHeaderCell class="standard-col-taxon">Associated taxon</VTableHeaderCell>
          <VTableHeaderCell class="standard-col-records">Records</VTableHeaderCell>
        </VTableHeaderRow>
      </VTableHeader>
      <VTableBody>
        <template v-for="section in visibleSections" :key="section.heading">
          <VTableBodyRow v-if="section.heading" class="standard-direction-heading">
            <VTableBodyCell colspan="3">{{ section.heading }}</VTableBodyCell>
          </VTableBodyRow>
          <template v-for="family in section.families" :key="`${section.heading}-${family.name}`">
            <VTableBodyRow class="standard-family-heading font-semibold">
              <VTableBodyCell class="standard-col-parts" aria-hidden="true" />
              <VTableBodyCell class="standard-col-taxon">
                {{ family.name || 'Family not specified' }}
              </VTableBodyCell>
              <VTableBodyCell class="standard-col-records" aria-hidden="true" />
            </VTableBodyRow>
          <VTableBodyRow v-for="row in family.rows" :key="row.key">
          <VTableBodyCell class="standard-col-parts">
            <PlantPartIcons :parts="row.parts" />
          </VTableBodyCell>
          <VTableBodyCell class="standard-col-taxon">
            <RouterLink
              v-if="row.otuId && row.families.length"
              :to="{ name: 'otus-id', params: { id: row.otuId } }"
              class="hover:underline"
            >
              <span :class="{ italic: row.italic }">{{ row.name }}</span>
            </RouterLink>
            <span v-else>
              <span :class="{ italic: row.italic }">{{ row.name }}</span>
            </span>
          </VTableBodyCell>
          <VTableBodyCell class="standard-col-records">
            <span class="standard-records-cell">
              <VButton
                class="standard-records-count"
                size="xs"
                variant="secondary"
                ghost
                :aria-label="'Show ' + row.count + ' records for ' + row.name + ' in Raw data'"
                @click="$emit('show-records', row)"
              >{{ row.count }}</VButton>
              <!-- Every category keeps its slot, so green, amber and red each
                   read as their own column down the table. An absent one is
                   hidden from sight and from screen readers. The dots carry no
                   text, so table copying stays untouched. -->
              <span class="standard-marks">
                <span
                  v-for="mark in rowMarks(row)"
                  :key="mark.key"
                  class="evidence-dot"
                  :class="[mark.class, { 'evidence-dot-empty': !mark.count }]"
                  :role="mark.count ? 'img' : undefined"
                  :aria-hidden="mark.count ? undefined : 'true'"
                  :aria-label="mark.count ? mark.title : undefined"
                  :title="mark.count ? mark.title : undefined"
                />
              </span>
            </span>
          </VTableBodyCell>
            </VTableBodyRow>
          </template>
        </template>
      </VTableBody>
    </VTable>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PlantPartIcons from './PlantPartIcons.vue'
import PlantPartInfo from './PlantPartInfo.vue'
import { uniquePlantParts } from './plantPartIcons.js'
import { copyTableSelection } from './tableClipboard.js'

const props = defineProps({
  sections: { type: Array, required: true }
})
defineEmits(['show-records'])

const tableRoot = ref(null)
const copySelection = event => copyTableSelection(event, tableRoot.value)
onMounted(() => document.addEventListener('copy', copySelection))
onBeforeUnmount(() => document.removeEventListener('copy', copySelection))
// Stage, rearing and wild feeding share the green dot: the mark says how much a
// record is worth in the field, not which rule let it in.
const MARK_STYLES = [
  { key: 'confirmed', class: 'text-success', reason: 'immature stage, or adult reared from or feeding observed in the wild' },
  { key: 'weak', class: 'text-warning', reason: 'adult collected from' },
  { key: 'excluded', class: 'text-danger', reason: 'vague relationships of adults: legacy, feeding observed in experimental setup and undefined relationship' }
]

/** All three slots, always, in a fixed order -- a row that only has red must
 *  not put its dot where its neighbour's green one sits. */
function rowMarks(row) {
  const counts = row.counts || {}
  return MARK_STYLES.map(mark => {
    const count = counts[mark.key] || 0
    return { ...mark, count, title: `${count} of ${row.count} records: ${mark.reason}` }
  })
}

const allRows = computed(() => props.sections.flatMap(section => section.rows))
const visibleRows = computed(() => allRows.value)
const visibleParts = computed(() => uniquePlantParts(visibleRows.value))
/** The dots keep their column because every row's count reserves the same
 *  width. Reserve only what the widest count in the table actually needs -- a
 *  fixed three digits throws away two digit widths on every row. */
const maxCountDigits = computed(() =>
  Math.max(1, ...visibleRows.value.map(row => String(Number(row.count) || 0).length)))
const visibleSections = computed(() => props.sections.map(section => {
  const rows = visibleRows.value.filter(row => section.rows.includes(row))
  const families = [...new Set(rows.flatMap(row => row.families.length ? row.families : ['']))]
    .sort((a, b) => {
      if (!a && b) return 1
      if (a && !b) return -1
      return a.localeCompare(b)
    })
    .map(name => ({ name, rows: rows.filter(row => name ? row.families.includes(name) : !row.families.length) }))
  return { ...section, rows, families }
}).filter(section => section.rows.length))
</script>

<style scoped>
.standard-association-table {
  width: fit-content;
  max-width: 100%;
  margin-inline: auto;
  overflow-x: auto;
}

.standard-association-table :deep(table) {
  width: auto;
}

.standard-association-table :deep(th),
.standard-association-table :deep(td) {
  padding: 0.45rem 0.75rem;
  vertical-align: middle;
}

.standard-association-table :deep(.standard-direction-heading td) {
  padding-top: 1.25rem;
  padding-bottom: 0.5rem;
  font-weight: 600;
  border: 0;
}

/* A family heading reads at the size of its rows and separates itself by
   weight, spacing and the missing rule -- the same way the direction heading
   above it does. */
.standard-association-table :deep(.standard-family-heading td) {
  padding-top: 0.9rem;
  padding-bottom: 0.35rem;
  text-align: center;
  border: 0;
}

.standard-association-table :deep(.standard-col-taxon) {
  min-width: 1rem;
  max-width: 24rem;
  text-align: center;
}

.standard-association-table :deep(.standard-col-parts) {
  min-width: 1rem;
  max-width: 13rem;
  text-align: right;
}

.standard-association-table :deep(.standard-col-parts > span) {
  justify-content: flex-end;
}

.standard-association-table :deep(.standard-col-records) {
  width: 1%;
  white-space: nowrap;
}

.standard-records-cell {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.standard-marks {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
}

/* The count reserves as many digits as the widest count in the table needs
   (--standard-count-digits, set by the component), so the dot columns still do
   not move between rows counting 1, 10 or 100 records -- without every row
   holding three digits free. .tp-button is content-box, so this min-width is
   the digit area alone; VButton size="xs" adds px-1.5 and a 1px border around
   it. tabular-nums makes every digit the same width; the 2px cover 1ch (the
   proportional zero) being a hair narrower than a tabular digit. Left aligned,
   so the count and the dots read as one block flush with the column edge. */
.standard-association-table :deep(.standard-records-count) {
  min-width: calc(var(--standard-count-digits, 3) * 1ch + 2px);
  text-align: left;
  font-variant-numeric: tabular-nums;
}

/* Colour comes from a theme token class (text-success/-warning/-danger), so the
   dot and its glow re-tint with the theme in both light and dark mode. */
.evidence-dot {
  display: inline-block;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 9999px;
  background: currentColor;
  box-shadow: 0 0 0.3rem currentColor;
}

/* An absent category holds its place rather than closing the gap. */
.evidence-dot-empty {
  visibility: hidden;
}

</style>
