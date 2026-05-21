/**
 * High-level helpers for AI disclosure. Mirrors @openxiv/lexicons but adds
 * presentation helpers (labels, colours, badge intent) the web app needs.
 */
export const DISCLOSURE_LEVEL_META = {
  none: {
    label: 'No AI',
    short: 'no-AI',
    description: 'Authors declare no AI assistance in this work.',
    tone: 'neutral' as const,
  },
  assistant: {
    label: 'AI-assisted',
    short: 'assist',
    description: 'AI helped with grammar, phrasing or minor edits. Substance authored by humans.',
    tone: 'info' as const,
  },
  coauthor: {
    label: 'AI co-author',
    short: 'co-author',
    description: 'AI drafted sections that the authors edited and verified.',
    tone: 'warning' as const,
  },
  primary: {
    label: 'AI-primary',
    short: 'AI-primary',
    description: 'AI is the principal author. Humans curated and validated outputs.',
    tone: 'caution' as const,
  },
} as const;

export type DisclosureToneClass = 'neutral' | 'info' | 'warning' | 'caution';
