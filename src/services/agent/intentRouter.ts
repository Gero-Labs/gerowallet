// src/services/agent/intentRouter.ts
export type AgentIntent =
  | { type: 'chart-token'; symbol: string }
  | { type: 'chat' };

const CHART_RE = /\b(?:chart|price)\b[^a-z0-9]*(?:of\s+|the\s+)*([a-z0-9]{2,12})\b/i;
const STOPWORDS = new Set(['the', 'price', 'chart', 'of', 'me', 'please', 'show', 'for']);

/** Deterministic parse of a user message into a typed intent. No LLM involved. */
export function parseIntent(text: string): AgentIntent {
  const match = CHART_RE.exec(text || '');
  if (match) {
    const candidate = match[1];
    if (!STOPWORDS.has(candidate.toLowerCase())) {
      return { type: 'chart-token', symbol: candidate.toUpperCase() };
    }
  }
  return { type: 'chat' };
}
