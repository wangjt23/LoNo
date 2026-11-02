import { esc } from '../format.js';

const date = value => value ? new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '未明确，需确认';
const priorities = { high: '重要', medium: '普通', low: '低优先级' };
export function renderTaskReview(result, current = {}) {
  const a = result.analysis;
  const fields = [['title', '标题', v => v], ['dueAt', '截止时间', date], ['remindAt', '提醒时间', date], ['priority', '重要程度', v => priorities[v]]];
  const same = (key, before, after) => key.endsWith('At') ? (!before && !after) || Date.parse(before) === Date.parse(after) : before === after;
  const changed = fields.filter(([key]) => !same(key, current[key], a[key])).length;
  const proposals = fields.map(([key, label, format]) => {
    const diff = !same(key, current[key], a[key]);
    return `<div class="${diff ? 'review-changed' : ''}"><dt>${label}${diff ? '<span class="review-change-label">建议修改</span>' : ''}</dt><dd>${diff ? `<span class="review-before">${esc(format(current[key]) ?? '未设置')}</span><span class="review-change-arrow">→</span>` : ''}<span>${esc(format(a[key]))}</span></dd></div>`;
  }).join('');
  return `<section class="ai-review"><div class="ai-summary-head"><strong>AI 整理预览</strong><span class="review-decision">${a.shouldRemind ? '建议保留提醒' : '建议无需处理'}</span></div><p class="review-reason">${esc(a.reason)}</p><p class="review-note">${changed ? `建议修改 ${changed} 项，以下显示当前值与建议值。` : '标题、时间和重要程度与当前填写一致。'} 确认保存时一并更新摘要。</p><dl class="review-proposal">${proposals}</dl>${a.summary ? `<p class="summary-overview">${esc(a.summary.overview)}</p><ul class="summary-points">${a.summary.keyPoints.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}${a.dueAt && Date.parse(a.dueAt) < Date.now() ? '<p class="review-note">原文截止时间已过，请核对。整理不会把过期安排放入今日安排。</p>' : ''}<div class="button-row review-actions"><button type="button" class="secondary" data-action="adopt-task-review">${a.shouldRemind ? '填入建议，再检查保存' : '仍保留提醒，填入建议'}</button>${!a.shouldRemind ? '<button type="button" class="primary" data-action="dismiss-task-review">确认无需处理</button>' : ''}<button type="button" class="text-button" data-action="cancel-task-review">暂不采用</button></div></section>`;
}
