<template>
  <span
    class="relative inline-flex"
    @mouseleave="hovered = false"
  >
    <button
      ref="trigger"
      type="button"
      class="cursor-pointer text-xs font-normal opacity-50 hover:opacity-100 focus:opacity-100"
      aria-label="About the evidence dots"
      :aria-expanded="visible"
      :aria-describedby="visible ? helpId : undefined"
      @mouseenter="hovered = true"
      @focus="hovered = true"
      @blur="hovered = false"
      @click.stop="open ? close() : (open = true)"
      @keydown.escape.stop="close"
    >ⓘ</button>

    <Teleport to="body">
    <span
      v-if="visible"
      ref="overlay"
      :id="helpId"
      role="tooltip"
      :style="position"
      class="fixed z-30 box-border w-[min(22rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-md border border-base-border bg-base-foreground p-2 text-base-content text-left text-xs font-normal normal-case leading-snug shadow-lg"
    >
      <span class="font-medium">A row's dots say how its records are classified:</span>
      <span
        v-for="mark in marks"
        :key="mark.key"
        class="mt-1 flex items-start gap-2"
      >
        <span class="legend-dot mt-1 shrink-0" :class="mark.class" />
        <span>{{ mark.reason }}</span>
      </span>
      <span class="mt-2 block text-base-soft">
        A category a row has no records of keeps its slot empty, so the three
        colours read as their own columns. Select the dots of a row to see how
        its records split between them.
      </span>
    </span>
    </Teleport>
  </span>
</template>

<script setup>
import { computed, ref, useId } from 'vue'
import { STANDARD_MARK_STYLES } from './standardEvidence.js'
import { useAnchoredPopover } from './useAnchoredPopover.js'

const open = ref(false)
const hovered = ref(false)
const visible = computed(() => open.value || hovered.value)
const helpId = `evidence-legend-${useId()}`
const marks = STANDARD_MARK_STYLES
// Records is the rightmost column, so the bubble hangs from the anchor's right
// edge instead of running off the viewport.
const { trigger, overlay, position } = useAnchoredPopover(visible, close, 'end')

function close() {
  open.value = false
  hovered.value = false
}
</script>

<style scoped>
/* The same disc as .evidence-dot in the table -- colour comes from a theme
   token class, so legend and table re-tint together in light and dark mode. */
.legend-dot {
  display: inline-block;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 9999px;
  background: currentColor;
  box-shadow: 0 0 0.3rem currentColor;
}
</style>
