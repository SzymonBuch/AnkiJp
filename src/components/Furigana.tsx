import type { ReactNode } from 'react'

const RUBY_RE = /<ruby>(.*?)<\/ruby>/gs

const HIGHLIGHT_CLASS = 'font-semibold text-blue-600 dark:text-sky-400'

/** Render bundled furigana HTML (`<ruby>base<rt>reading</rt></ruby>`) as React nodes. */
export function Furigana({ html, highlight }: { html: string; highlight?: string }) {
  return <>{parseFurigana(html, highlight)}</>
}

function parseFurigana(html: string, highlight?: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const matches = [...html.matchAll(RUBY_RE)]
  let last = 0
  matches.forEach((match, index) => {
    if (match.index !== undefined && match.index > last) {
      nodes.push(...withHighlight(html.slice(last, match.index), highlight, `t${index}`))
    }
    nodes.push(parseRuby(match[1], index, highlight))
    last = (match.index ?? 0) + match[0].length
  })
  if (last < html.length) nodes.push(...withHighlight(html.slice(last), highlight, 'tz'))
  return nodes
}

function parseRuby(inner: string, key: number, highlight?: string): ReactNode {
  const rtStart = inner.indexOf('<rt>')
  const rtEnd = inner.indexOf('</rt>')
  if (rtStart === -1 || rtEnd === -1) return inner
  return (
    <ruby key={key}>
      {withHighlight(inner.slice(0, rtStart), highlight, `b${key}`)}
      <rt className="text-[0.55em] text-slate-500 dark:text-slate-400">{inner.slice(rtStart + 4, rtEnd)}</rt>
    </ruby>
  )
}

function withHighlight(text: string, highlight: string | undefined, keyPrefix: string): ReactNode[] {
  if (!highlight || !text.includes(highlight)) return [text]
  const parts = text.split(highlight)
  const nodes: ReactNode[] = []
  parts.forEach((part, index) => {
    if (part) nodes.push(part)
    if (index < parts.length - 1) {
      nodes.push(
        <span key={`${keyPrefix}-${index}`} className={HIGHLIGHT_CLASS}>
          {highlight}
        </span>,
      )
    }
  })
  return nodes
}
