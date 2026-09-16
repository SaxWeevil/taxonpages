import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

/** Position a body-teleported overlay within the visible viewport. */
export function popoverPosition(anchor, box, viewport, align = 'start') {
  const preferredLeft = align === 'end' ? anchor.right - box.width : anchor.left
  const left = Math.max(16, Math.min(preferredLeft, viewport.width - box.width - 16))
  const below = anchor.bottom + 8
  const top = below + box.height <= viewport.height - 16
    ? below : Math.max(16, anchor.top - box.height - 8)
  return { left: `${left}px`, top: `${top}px` }
}

/** Shared positioning and dismissal for header help and the relationship
 * selection. Teleport escapes the panel/table scroll containers, while the
 * trigger stays in the normal responsive layout.
 */
export function useAnchoredPopover(visible, close, align = 'start') {
  const trigger = ref(null)
  const overlay = ref(null)
  const position = ref({ left: '16px', top: '16px' })
  let observer
  const triggerElement = () => trigger.value?.$el || trigger.value

  async function reposition() {
    await nextTick()
    if (!visible.value || !triggerElement() || !overlay.value) return
    position.value = popoverPosition(
      triggerElement().getBoundingClientRect(), overlay.value.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight }, align
    )
  }

  function outsideClick(event) {
    if (!triggerElement()?.contains(event.target) && !overlay.value?.contains(event.target)) close()
  }

  function onKeydown(event) {
    if (event.key === 'Escape') close()
  }

  function onScroll(event) {
    if (!overlay.value?.contains(event.target)) close()
  }

  watch([visible, overlay], () => {
    observer?.disconnect()
    if (visible.value && overlay.value) observer?.observe(overlay.value)
    reposition()
  }, { flush: 'post' })
  onMounted(() => {
    if (typeof ResizeObserver !== 'undefined') observer = new ResizeObserver(reposition)
    document.addEventListener('pointerdown', outsideClick)
    document.addEventListener('keydown', onKeydown)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', onScroll, true)
  })
  onBeforeUnmount(() => {
    observer?.disconnect()
    document.removeEventListener('pointerdown', outsideClick)
    document.removeEventListener('keydown', onKeydown)
    window.removeEventListener('resize', close)
    window.removeEventListener('scroll', onScroll, true)
  })
  return { trigger, overlay, position }
}
