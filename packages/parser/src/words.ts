/**
 * Words as the tagger sees them. Keep in sync with WORD in py/common.py:
 * runs of anything but whitespace and . , ; : ! ? ( ) [ ] ` " , and each of those on its own.
 */
const WORD = /[^\s.,;:!?()\[\]`"]+|[.,;:!?()\[\]`"]/g

export type Word = { start: number; end: number }

export const words = (text: string): Word[] => [...text.matchAll(WORD)].map((m) => ({ start: m.index!, end: m.index! + m[0].length }))
