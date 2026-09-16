import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer, h, nextTick, ref } from 'vue'
import { useAnchoredPopover } from './useAnchoredPopover.js'

// The composable talks to bare `document`/`window` globals, so the whole point
// of these tests -- which listener fires and what it does -- is only reachable
// with a stand-in DOM. There is no jsdom in this repo; a handful of stubs and
// Vue's custom renderer are enough, because nothing here touches real layout.
const nop = () => {}
const { createApp } = createRenderer({
  createElement: tag => ({ tag, children: [] }),
  createText: text => ({ text }), createComment: text => ({ text }),
  setText: nop, setElementText: nop, remove: nop,
  parentNode: () => null, nextSibling: () => null, patchProp: nop,
  insert: (child, parent) => { parent.children?.push(child) }
})

function install(t) {
  const listeners = { document: new Map(), window: new Map() }
  const frames = []
  const target = store => ({
    addEventListener: (type, fn) => store.set(type, fn),
    removeEventListener: (type, fn) => { if (store.get(type) === fn) store.delete(type) }
  })
  const saved = { ...globalThis }
  globalThis.document = target(listeners.document)
  globalThis.window = { ...target(listeners.window), innerWidth: 1000, innerHeight: 800 }
  globalThis.requestAnimationFrame = fn => frames.push(fn)
  globalThis.cancelAnimationFrame = nop
  t.after(() => {
    for (const key of ['document', 'window', 'requestAnimationFrame', 'cancelAnimationFrame']) {
      if (key in saved) globalThis[key] = saved[key]
      else delete globalThis[key]
    }
  })
  const flushFrames = async () => {
    const pending = frames.splice(0)
    pending.forEach(fn => fn())
    await nextTick()
    await nextTick()
  }
  return { listeners, flushFrames }
}

/** Mount the composable with both refs pointed at stand-in elements. */
async function mountPopover(t, { closeOnScroll, anchor }) {
  const env = install(t)
  const visible = ref(true)
  let closed = 0
  const api = {}
  const app = createApp({
    setup() {
      Object.assign(api, useAnchoredPopover(visible, () => { closed += 1; visible.value = false },
        'end', closeOnScroll))
      return () => h('div')
    }
  })
  app.mount({ tag: 'root', children: [] })
  const overlay = { children: [], contains: node => node === overlay, getBoundingClientRect: () => ({ width: 300, height: 200 }) }
  api.trigger.value = { contains: () => false, getBoundingClientRect: () => anchor() }
  api.overlay.value = overlay
  await nextTick(); await nextTick()
  return { ...env, ...api, overlay, closedCount: () => closed, visible }
}

const rectAt = top => ({ left: 400, right: 500, top, bottom: top + 24 })

test('a help popover still dismisses itself when the page scrolls', async t => {
  const popover = await mountPopover(t, { closeOnScroll: true, anchor: () => rectAt(300) })
  popover.listeners.window.get('scroll')({ target: { other: true } })
  assert.equal(popover.closedCount(), 1)
})

test('a selection menu survives scrolling and follows its trigger', async t => {
  let top = 300
  const popover = await mountPopover(t, { closeOnScroll: false, anchor: () => rectAt(top) })
  const before = popover.position.value.top
  top = 120
  popover.listeners.window.get('scroll')({ target: { other: true } })
  await popover.flushFrames()
  assert.equal(popover.closedCount(), 0, 'the draft selection must not be thrown away')
  assert.notEqual(popover.position.value.top, before, 'the menu follows the button it belongs to')
  assert.equal(popover.position.value.top, `${120 + 24 + 8}px`)
})

test('scrolling inside the menu itself changes nothing', async t => {
  const popover = await mountPopover(t, { closeOnScroll: false, anchor: () => rectAt(300) })
  const before = { ...popover.position.value }
  popover.listeners.window.get('scroll')({ target: popover.overlay })
  await popover.flushFrames()
  assert.equal(popover.closedCount(), 0)
  assert.deepEqual(popover.position.value, before)
})

test('the menu closes once its trigger has scrolled out of the viewport', async t => {
  let top = 300
  const popover = await mountPopover(t, { closeOnScroll: false, anchor: () => rectAt(top) })
  top = -80 // bottom = -56, entirely above the fold
  popover.listeners.window.get('scroll')({ target: { other: true } })
  await popover.flushFrames()
  assert.equal(popover.closedCount(), 1, 'a menu with no visible anchor is worse than none')
})

test('a resize repositions the selection menu instead of discarding it', async t => {
  const popover = await mountPopover(t, { closeOnScroll: false, anchor: () => rectAt(300) })
  popover.listeners.window.get('resize')()
  await popover.flushFrames()
  assert.equal(popover.closedCount(), 0)
})

test('a resize still dismisses a help popover', async t => {
  const popover = await mountPopover(t, { closeOnScroll: true, anchor: () => rectAt(300) })
  popover.listeners.window.get('resize')()
  assert.equal(popover.closedCount(), 1)
})

test('a pointer press outside closes either kind', async t => {
  for (const closeOnScroll of [true, false]) {
    const popover = await mountPopover(t, { closeOnScroll, anchor: () => rectAt(300) })
    popover.listeners.document.get('pointerdown')({ target: { elsewhere: true } })
    assert.equal(popover.closedCount(), 1)
  }
})

test('Escape closes either kind', async t => {
  for (const closeOnScroll of [true, false]) {
    const popover = await mountPopover(t, { closeOnScroll, anchor: () => rectAt(300) })
    popover.listeners.document.get('keydown')({ key: 'Escape' })
    assert.equal(popover.closedCount(), 1)
  }
})
