/**
 * reportPanelError.js
 *
 * Logs a failed optional request for this panel — never thrown, never shown
 * to the reader directly (each caller already degrades its own view
 * gracefully on failure); only surfaced to the console, and only when the
 * host app has debug logging turned on.
 *
 * Depended on by:
 *   - PanelBiologicalAssociationsV2.vue
 *   - AdvancedAssociationsTable.vue
 */
export function reportPanelError(error, context) {
  if (typeof __APP_ENV__ !== 'undefined' && __APP_ENV__.debug && typeof console !== 'undefined') {
    console.warn('[biological-associations]', {
      view: context.view,
      phase: context.phase,
      route: context.route,
      status: error?.response?.status || error?.status || null,
      message: error?.message || String(error)
    })
  }
}
