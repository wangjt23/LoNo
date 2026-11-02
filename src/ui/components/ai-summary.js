import { esc, dateText } from '../format.js';

export function renderAiSummary(recordId, analysis) {
  const summary = analysis.summary;
  const available = summary?.engine === 'model' && summary.overview && Array.isArray(summary.keyPoints);
  if (!available) return '';
  return `<section class="ai-summary" data-record-id="${esc(recordId)}" aria-label="要点摘要"><div class="ai-summary-head"><strong>要点摘要</strong></div><p class="summary-overview">${esc(summary.overview)}</p><ul class="summary-points">${summary.keyPoints.map(point => `<li>${esc(point)}</li>`).join('')}</ul><small>基于原始信息 · ${esc(summary.model || 'AI')} · ${dateText(summary.generatedAt)}</small></section>`;
}
