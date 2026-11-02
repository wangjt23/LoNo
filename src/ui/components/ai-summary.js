import { esc, dateText } from '../format.js';

export function renderAiSummary(recordId, analysis, modelEnabled) {
  const summary = analysis.summary;
  const available = summary?.engine === 'model' && summary.overview && Array.isArray(summary.keyPoints);
  return `<section class="ai-summary" data-record-id="${esc(recordId)}" aria-label="AI 摘要"><div class="ai-summary-head"><strong><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="2"/><rect x="14" y="4" width="6" height="6" rx="2"/><rect x="4" y="14" width="6" height="6" rx="2"/><rect x="14" y="14" width="6" height="6" rx="2"/></svg> AI 摘要</strong><button type="button" class="text-button" data-action="summarize-record" data-id="${esc(recordId)}" ${modelEnabled ? '' : 'disabled'}>${available ? '重新生成' : '生成摘要'}</button></div>${available ? `<p class="summary-overview">${esc(summary.overview)}</p><ul class="summary-points">${summary.keyPoints.map(point => `<li>${esc(point)}</li>`).join('')}</ul><small>基于原始信息 · ${esc(summary.model || 'AI')} · ${dateText(summary.generatedAt)}</small>` : `<p class="summary-empty">${modelEnabled ? '暂无摘要。点击生成，快速了解原文重点。' : '启用模型后，可在这里生成原文摘要。'}</p>`}</section>`;
}
