import { esc } from '../format.js';

const date = value => value ? new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '未明确，需确认';
const priorities = { high: '重要', medium: '普通', low: '低优先级' };
export function renderTaskReview(result) {
  const a = result.analysis;
  return `<section class="ai-review"><div class="ai-summary-head"><strong>AI 整理预览</strong><span class="review-decision">${a.shouldRemind ? '建议保留提醒' : '建议无需处理'}</span></div><p class="review-reason">${esc(a.reason)}</p><dl class="review-proposal"><div><dt>建议标题</dt><dd>${esc(a.title)}</dd></div><div><dt>截止时间</dt><dd>${date(a.dueAt)}</dd></div><div><dt>提醒时间</dt><dd>${date(a.remindAt)}</dd></div><div><dt>重要程度</dt><dd>${priorities[a.priority]}</dd></div></dl>${a.summary ? `<p class="summary-overview">${esc(a.summary.overview)}</p><ul class="summary-points">${a.summary.keyPoints.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}${a.dueAt && Date.parse(a.dueAt) < Date.now() ? '<p class="review-note">原文截止时间已过，请核对。整理不会把过期安排放入今日安排。</p>' : ''}<div class="button-row review-actions"><button type="button" class="secondary" data-action="adopt-task-review">${a.shouldRemind ? '填入建议，再检查保存' : '仍保留提醒，填入建议'}</button>${!a.shouldRemind ? '<button type="button" class="primary" data-action="dismiss-task-review">确认无需处理</button>' : ''}<button type="button" class="text-button" data-action="cancel-task-review">暂不采用</button></div></section>`;
}
