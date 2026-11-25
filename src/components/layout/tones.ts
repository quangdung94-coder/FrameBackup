/** Màu nhận diện từng cột: 1 thẻ nhớ (amber), 2 Ổ 1 (blue), 3 Ổ 2 (emerald), 4 Drive (purple). */
export type ColumnTone = 'amber' | 'blue' | 'emerald' | 'purple';

// Viết đủ tên class (không ghép chuỗi) để Tailwind quét được.
export const TONE_BADGE: Record<ColumnTone, string> = {
  amber: 'bg-amber-500/20 text-amber-400 border border-amber-500/40',
  blue: 'bg-blue-500/20 text-blue-400 border border-blue-500/40',
  emerald: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40',
  purple: 'bg-purple-500/20 text-purple-400 border border-purple-500/40',
};

export const TONE_BAR: Record<ColumnTone, string> = {
  amber: 'bg-amber-500',
  blue: 'bg-blue-500',
  emerald: 'bg-emerald-500',
  purple: 'bg-purple-500',
};
