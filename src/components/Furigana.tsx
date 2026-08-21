import type { ReactNode } from 'react'

const RUBY_RE = /<ruby>(.*?)<\/ruby>/gs

/** Render bundled furigana HTML (`<ruby>base<rt>reading</rt></ruby>`) as React nodes. */
export function Furigana({ html }: { html: string }) {
  return <>{parseFurigana(html)}</>
}

function parseFurigana(html: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const matches = [...html.matchAll(RUBY_RE)]
  let last = 0
  matches.forEach((match, index) => {
    if (match.index !== undefined && match.index > last) {
      nodes.push(html.slice(last, match.index))
    }
    nodes.push(parseRuby(match[1], index))
    last = (match.index ?? 0) + match[0].length
  })
  if (last < html.length) nodes.push(html.slice(last))
  return nodes
}

function parseRuby(inner: string, key: number): ReactNode {
  const rtStart = inner.indexOf('<rt>')
  const rtEnd = inner.indexOf('</rt>')
  if (rtStart === -1 || rtEnd === -1) return inner
  return (
    <ruby key={key}>
      {inner.slice(0, rtStart)}
      <rt className="text-[0.55em] text-slate-500 dark:text-slate-400">{inner.slice(rtStart + 4, rtEnd)}</rt>
    </ruby>
  )
}
