export const memoryKey = text => text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

export function extractLocalMemories(text) {
  return text.split(/[。；;\n]/).map(s => s.trim()).filter(s => s.length >= 6 && s.length <= 1000).flatMap(content => {
    let kind;
    if (/我(?:习惯|偏好|喜欢)|默认.{0,15}(?:提醒|时间|格式)|通常.{0,15}(?:提前|提醒)/.test(content)) kind = 'preference';
    else if (/(?:负责|对接|联系人).{0,25}(?:一直|长期)|(?:一直|长期).{0,25}(?:负责|对接|联系人)/.test(content)) kind = 'person';
    else if (/(?:流程.{0,80}先.{0,80}再|(?:每周|每月|每次|通常).{0,80}(?:先|提交|审核|报送|发送))/.test(content)) kind = 'workflow';
    return kind ? [{ kind, content, evidence: content }] : [];
  }).slice(0, 8);
}



function terms(text) {
  const normalized = memoryKey(text);
  const tokens = normalized.match(/[a-z0-9_]{2,}|[\p{Script=Han}]+/gu) || [];
  return new Set(tokens.flatMap(t => /\p{Script=Han}/u.test(t) ? Array.from({ length: Math.max(0, t.length - 1) }, (_, i) => t.slice(i, i + 2)) : [t]));
}
export function retrieveMemories(memories, text, limit = 5) {
  const query = terms(text);
  return memories.filter(m => m.status === 'approved').map(m => {
    const tokens = terms(m.content);
    const hits = [...query].filter(t => tokens.has(t)).length;
    return { ...m, score: hits / Math.sqrt(Math.max(1, tokens.size)) };
  }).filter(m => m.score > 0).sort((a, b) => b.score - a.score || b.updated_at.localeCompare(a.updated_at)).slice(0, limit);
}
