/**
 * Etap 2 checklist: radical glyphs living outside the coverage of common CJK
 * system fonts. Every target platform must be eyeballed for these (Deck →
 * Radicals, or the Settings checklist); when one renders as tofu, the UI
 * shows a readable code-point label instead of an invisible blank.
 */
export const EXOTIC_GLYPHS = ['⺊', '㇇', '⺌', '⻌', '㇉', '⺕', '㇀']

/** `⺊` → `U+2E8A` — readable stand-in when a glyph has no font coverage. */
export function describeCodePoint(glyph: string): string {
  const code = glyph.codePointAt(0)
  return code === undefined ? '?' : `U+${code.toString(16).toUpperCase()}`
}

const detectionCache = new Map<string, boolean>()

/** A guaranteed-unassigned code point — whatever it measures is pure tofu. */
const TOFU_PROBE = '\u{10FFFE}'
const FONT_STACKS = ['sans-serif', 'serif', 'monospace']

/**
 * Best-effort tofu detection via canvas advance widths: a glyph that measures
 * exactly like the unassigned probe in every generic family (or not at all)
 * almost certainly has no font coverage. Heuristic only — the final word on
 * rendering quality belongs to the visual checklist.
 */
export function isGlyphRenderable(glyph: string): boolean {
  const cached = detectionCache.get(glyph)
  if (cached !== undefined) return cached
  let renderable = true
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (ctx) {
      renderable = !FONT_STACKS.every((stack) => {
        ctx.font = `72px ${stack}`
        const probe = ctx.measureText(TOFU_PROBE).width
        const width = ctx.measureText(glyph).width
        return width === 0 || Math.abs(width - probe) < 0.01
      })
    }
  }
  detectionCache.set(glyph, renderable)
  return renderable
}
