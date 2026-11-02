import { validateEndpoint, readJson } from './http.js';

// Shared transport policy for classification, memory extraction and summaries.
// Domain services retain their own schema validation and fallback decisions.
export async function requestModelJson(model, messages, { fetchImpl = fetch, timeoutMs = 25000, maxTokens } = {}) {
  if (!model.enabled) throw new Error('模型未启用');
  const url = validateEndpoint(model.endpoint);
  const providerOptions = url.hostname === 'api.deepseek.com' ? { thinking: { type: 'disabled' }, max_tokens: 2048 } : {};
  const response = await fetchImpl(url, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
    headers: { 'Content-Type': 'application/json', ...(model.apiKey ? { Authorization: `Bearer ${model.apiKey}` } : {}) },
    body: JSON.stringify({ model: model.model, temperature: 0, ...providerOptions, ...(maxTokens ? { max_tokens: maxTokens } : {}), response_format: { type: 'json_object' }, messages }),
  });
  const data = await readJson(response);
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('模型未返回 JSON 内容');
  return JSON.parse(content);
}
