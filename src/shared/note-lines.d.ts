// Types for note-lines.js.
/** A note's prose lines (code excluded) with their 0-based line index. */
export function noteProseLines(source: string): { line: string; index: number }[];
