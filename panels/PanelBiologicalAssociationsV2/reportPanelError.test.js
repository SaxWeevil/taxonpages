import assert from 'node:assert/strict'
import { test } from 'node:test'
import { reportPanelError } from './reportPanelError.js'

function withDebugFlag(debug, fn) {
  const previousEnv = globalThis.__APP_ENV__
  const previousWarn = console.warn
  const calls = []
  console.warn = (...args) => calls.push(args)
  globalThis.__APP_ENV__ = { debug }
  try {
    fn()
    return calls
  } finally {
    console.warn = previousWarn
    globalThis.__APP_ENV__ = previousEnv
  }
}

test('stays silent when debug logging is off', () => {
  const calls = withDebugFlag(false, () => {
    reportPanelError(new Error('boom'), { view: 'raw', phase: 'test', route: '/test' })
  })
  assert.equal(calls.length, 0)
})

test('logs view, phase, route, status and message when debug logging is on', () => {
  const error = Object.assign(new Error('boom'), { response: { status: 500 } })
  const calls = withDebugFlag(true, () => {
    reportPanelError(error, { view: 'raw', phase: 'test', route: '/test' })
  })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], ['[biological-associations]', {
    view: 'raw', phase: 'test', route: '/test', status: 500, message: 'boom'
  }])
})

test('falls back to a bare status/message when there is no response object', () => {
  const calls = withDebugFlag(true, () => {
    reportPanelError({ status: 404, message: 'not found' }, { view: 'advanced', phase: 'x', route: '/y' })
  })
  assert.deepEqual(calls[0][1], { view: 'advanced', phase: 'x', route: '/y', status: 404, message: 'not found' })
})
