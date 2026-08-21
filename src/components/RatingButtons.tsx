import { ratingOutcome, type Rating, type SrsCard } from '../lib/srs'

const RATINGS: { value: Rating; label: string; shortcut: string; color: string }[] = [
  { value: 'again', label: 'Again', shortcut: '1', color: '#e04848' },
  { value: 'hard', label: 'Hard', shortcut: '2', color: '#ff9900' },
  { value: 'good', label: 'Good', shortcut: '3', color: '#33cc66' },
  { value: 'easy', label: 'Easy', shortcut: '4', color: '#2f80ed' },
]

interface RatingButtonsProps {
  /** Current card — when given, each button shows what the rating would do. */
  card?: SrsCard | null
  disabled?: boolean
  onRate: (rating: Rating) => void
}

export function RatingButtons({ card, disabled, onRate }: RatingButtonsProps) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {RATINGS.map((rating) => (
        <button
          key={rating.value}
          type="button"
          disabled={disabled}
          onClick={() => onRate(rating.value)}
          style={{ backgroundColor: rating.color }}
          className="rounded-xl px-2 py-3 text-white shadow-md transition active:scale-95 disabled:opacity-50"
        >
          <span className="block text-sm font-bold leading-tight sm:text-base">{rating.label}</span>
          {card && (
            <span className="block text-[11px] leading-tight opacity-90">
              {ratingOutcome(card, rating.value)}
            </span>
          )}
          <span className="block text-xs opacity-75">{rating.shortcut}</span>
        </button>
      ))}
    </div>
  )
}
