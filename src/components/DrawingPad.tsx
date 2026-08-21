import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

const SIZE = 256
const MAX_UNDO_STEPS = 20
const BRUSH_WIDTH = 4
const ERASER_WIDTH = 24

const COLORS = ['#0f172a', '#be1428', '#2563eb', '#16a34a', '#f59e0b']

interface Point {
  x: number
  y: number
}

interface DrawingPadProps {
  kanji: string
  initial?: string | null
  onSave: (dataUrl: string) => void
  onClose: () => void
}

/** Modal drawing pad for user-made mnemonic sketches (F3). */
export function DrawingPad({ kanji, initial, onSave, onClose }: DrawingPadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const undoStack = useRef<ImageData[]>([])
  const drawingRef = useRef(false)
  const lastPoint = useRef<Point | null>(null)
  const [color, setColor] = useState(COLORS[0])
  const [eraser, setEraser] = useState(false)
  const [canUndo, setCanUndo] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = SIZE * dpr
    canvas.height = SIZE * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, SIZE, SIZE)
    if (initial) {
      const image = new Image()
      image.onload = () => ctx.drawImage(image, 0, 0, SIZE, SIZE)
      image.src = initial
    }
  }, [initial])

  const context = () => canvasRef.current?.getContext('2d') ?? null

  const pushUndo = () => {
    const canvas = canvasRef.current
    const ctx = context()
    if (!canvas || !ctx) return
    undoStack.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height))
    if (undoStack.current.length > MAX_UNDO_STEPS) undoStack.current.shift()
    setCanUndo(true)
  }

  const pointFromEvent = (event: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: (event.clientX - rect.left) * (SIZE / rect.width),
      y: (event.clientY - rect.top) * (SIZE / rect.height),
    }
  }

  const strokeSegment = (from: Point, to: Point) => {
    const ctx = context()
    if (!ctx) return
    ctx.globalCompositeOperation = eraser ? 'destination-out' : 'source-over'
    ctx.strokeStyle = color
    ctx.lineWidth = eraser ? ERASER_WIDTH : BRUSH_WIDTH
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
  }

  const stampDot = (point: Point) => {
    const ctx = context()
    if (!ctx) return
    ctx.globalCompositeOperation = eraser ? 'destination-out' : 'source-over'
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(point.x, point.y, (eraser ? ERASER_WIDTH : BRUSH_WIDTH) / 2, 0, Math.PI * 2)
    ctx.fill()
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    pushUndo()
    drawingRef.current = true
    lastPoint.current = pointFromEvent(event)
    stampDot(lastPoint.current)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || !lastPoint.current) return
    const point = pointFromEvent(event)
    strokeSegment(lastPoint.current, point)
    lastPoint.current = point
  }

  const endStroke = () => {
    drawingRef.current = false
    lastPoint.current = null
  }

  const undo = () => {
    const snapshot = undoStack.current.pop()
    const ctx = context()
    if (!snapshot || !ctx) return
    ctx.putImageData(snapshot, 0, 0)
    setCanUndo(undoStack.current.length > 0)
  }

  const clear = () => {
    const ctx = context()
    if (!ctx) return
    pushUndo()
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, SIZE, SIZE)
  }

  const save = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    onSave(canvas.toDataURL('image/png'))
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-100/95 backdrop-blur-sm">
      <div className="mx-auto flex min-h-full w-full max-w-xl flex-col items-center gap-4 p-4">
        <div className="flex w-full items-center justify-between">
          <h2 className="text-lg font-semibold">
            My drawing — <span className="text-2xl">{kanji}</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 font-medium text-slate-600 transition active:scale-95"
          >
            Close
          </button>
        </div>

        <div className="flex w-full flex-wrap items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          {COLORS.map((value) => (
            <button
              key={value}
              type="button"
              aria-label={`Brush color ${value}`}
              aria-pressed={!eraser && color === value}
              onClick={() => {
                setColor(value)
                setEraser(false)
              }}
              className={`h-9 w-9 rounded-full border-2 transition active:scale-90 ${
                !eraser && color === value ? 'scale-110 border-slate-800' : 'border-transparent'
              }`}
              style={{ backgroundColor: value }}
            />
          ))}
          <button
            type="button"
            onClick={() => setEraser((prev) => !prev)}
            aria-pressed={eraser}
            className={`min-h-11 rounded-lg px-3 text-sm font-medium transition active:scale-95 ${
              eraser
                ? 'bg-slate-800 text-white shadow-md'
                : 'border border-slate-300 bg-white text-slate-600'
            }`}
          >
            Eraser
          </button>
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-600 transition active:scale-95 disabled:opacity-40"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={clear}
            className="min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-600 transition active:scale-95"
          >
            Clear
          </button>
        </div>

        <canvas
          ref={canvasRef}
          width={SIZE}
          height={SIZE}
          style={{ width: SIZE, height: SIZE }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          className="touch-none rounded-xl border border-slate-300 bg-white shadow-md"
        />

        <button
          type="button"
          onClick={save}
          className="w-full rounded-xl bg-slate-800 px-6 py-3 font-semibold text-white shadow-md transition active:scale-95"
        >
          Save drawing
        </button>
      </div>
    </div>
  )
}
