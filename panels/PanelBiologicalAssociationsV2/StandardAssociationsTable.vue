<template>
  <div ref="tableRoot">
    <VTable class="standard-association-table">
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
            <VButton
              size="xs"
              variant="secondary"
              ghost
              :aria-label="'Show ' + row.count + ' records for ' + row.name + ' in Raw data'"
              @click="$emit('show-records', row)"
            >{{ row.count }}</VButton>
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
const allRows = computed(() => props.sections.flatMap(section => section.rows))
const visibleRows = computed(() => allRows.value)
const visibleParts = computed(() => uniquePlantParts(visibleRows.value))
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

</style>
