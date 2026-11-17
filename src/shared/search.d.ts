// Types for the search the browser and the account share (search.js stays the source of truth).

export const SEARCH_KINDS: Record<string, string[]>;

export interface SearchRow { kind: string; uid: string; title: string; body: string; updated: number }
export interface SearchMatch extends SearchRow { snippet: string; score: number }

export function documentRows(name: string, doc: Record<string, unknown> | null | undefined): SearchRow[];
export function chatRows(chat: unknown): SearchRow[];
export function searchWords(query: string): string[];
/** The first match's surroundings, with its words marked by \u0001…\u0002. */
export function excerpt(text: string, words: string[]): string;
export function localSearch(rows: SearchRow[], query: string): SearchMatch[];
