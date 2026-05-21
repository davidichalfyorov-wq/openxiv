export const SUMMARY_PROMPTS = {
  school: (paperText: string): string =>
    `You are writing a plain-language summary of a research paper for a curious high-school reader.
Avoid jargon. Use short sentences. Explain the question, the approach, and what was found in 6–10 sentences (~200 words).
Do not invent facts; only describe what the paper claims.

PAPER:
"""
${truncate(paperText, 20000)}
"""

SUMMARY:`,
  undergrad: (paperText: string): string =>
    `You are writing a plain-language summary for an undergraduate in the relevant discipline.
Assume basic vocabulary of the field but not advanced familiarity. 6–10 sentences (~250 words).

PAPER:
"""
${truncate(paperText, 24000)}
"""

SUMMARY:`,
  expert: (paperText: string): string =>
    `You are writing a structured technical summary for an expert in the field.
Cover: (1) problem statement, (2) method, (3) main results, (4) limitations. 8–12 sentences.

PAPER:
"""
${truncate(paperText, 32000)}
"""

SUMMARY:`,
} as const;

export const EXPLAIN_PROMPTS = {
  school: (paperText: string): string =>
    `Explain this paper to a high-school student. Use everyday analogies. 8–12 sentences.

PAPER:
"""
${truncate(paperText, 30000)}
"""

EXPLANATION:`,
  undergrad: (paperText: string): string =>
    `Explain this paper to an undergraduate in the same discipline. Walk through the method without skipping it. 10–15 sentences.

PAPER:
"""
${truncate(paperText, 30000)}
"""

EXPLANATION:`,
  expert: (paperText: string): string =>
    `Explain this paper to a researcher in an adjacent subfield. Highlight what is novel, what is incremental, and what assumptions matter. 10–15 sentences.

PAPER:
"""
${truncate(paperText, 32000)}
"""

EXPLANATION:`,
} as const;

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '\n[truncated]';
}
