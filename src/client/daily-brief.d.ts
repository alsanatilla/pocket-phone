// Types for the parts of daily-brief.js the React client uses.
export interface BriefFact { id: string; kind: string; href: string; text: string }
export interface Brief { day: string; summary: string; heading: string; text: string; context: string; facts: BriefFact[] }
export function briefEnabled(): boolean;
export function readBrief(): Brief;
