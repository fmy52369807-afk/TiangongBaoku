async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const response = await fetch(path, { ...options, headers });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text || response.statusText }; }
  if (!response.ok) throw new Error(data.error || '请求失败：HTTP ' + response.status);
  return data;
}

async function apiPost(path, body = {}) {
  return api(path, { method: 'POST', body: JSON.stringify(body) });
}
