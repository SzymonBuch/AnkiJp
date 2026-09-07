import { describeCodePoint, isGlyphRenderable } from '../lib/glyphs'

/**
 * Radical glyph rendering with a graceful fallback: when no installed font
 * covers the code point (tofu box), show the readable `U+XXXX` form so the
 * card stays usable (Etap 2 exotic-glyph checklist).
 */
export function RadicalGlyph({
  glyph,
  className = '',
}: {
  glyph: string
  className?: string
}) {
  if (isGlyphRenderable(glyph)) {
    return <span className={`select-none ${className}`}>{glyph}</span>
  }
  return (
    <span className={`flex select-none flex-col items-center justify-center leading-none ${className}`}>
      <span aria-hidden="true" className="opacity-40">□</span>
      <span className="mt-1 font-mono text-xs font-normal text-slate-400 dark:text-slate-500">
        {describeCodePoint(glyph)}
      </span>
    </span>
  )
}
