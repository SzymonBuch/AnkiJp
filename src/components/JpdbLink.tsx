interface JpdbLinkProps {
  href: string
  label?: string
  ariaLabel?: string
}

export function JpdbLink({ href, label = 'Open in jpdb', ariaLabel }: JpdbLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={ariaLabel}
      className="inline-flex min-h-11 items-center rounded-lg border border-sky-300 px-3 text-sm font-semibold text-sky-700 transition hover:bg-sky-50 active:scale-95 dark:border-sky-700 dark:text-sky-300 dark:hover:bg-sky-950/40"
    >
      {label}
    </a>
  )
}
