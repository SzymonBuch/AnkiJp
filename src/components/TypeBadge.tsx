import type { ContentType } from '../lib/srs'

const BADGE: Record<ContentType, { label: string; classes: string }> = {
  radical: {
    label: 'Radical',
    classes:
      'bg-violet-100 text-violet-700 border-violet-300 dark:bg-violet-950/60 dark:text-violet-300 dark:border-violet-800',
  },
  kanji: {
    label: 'Kanji',
    classes:
      'bg-sky-100 text-sky-700 border-sky-300 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800',
  },
  vocab: {
    label: 'Word',
    classes:
      'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800',
  },
}

/**
 * Disambiguates identical fronts (`r:一` vs `k:一` are both rendered as 一):
 * every session and quiz card shows what kind of content it carries.
 */
export function TypeBadge({ type }: { type: ContentType }) {
  const { label, classes } = BADGE[type]
  return (
    <span
      className={`rounded-md border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${classes}`}
    >
      {label}
    </span>
  )
}
