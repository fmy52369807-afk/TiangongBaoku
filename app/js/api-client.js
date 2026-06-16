async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  let response;
  try {
    response = await fetch(path, { ...options, headers });
  } catch (error) {
    throw new Error('无法连接本地服务。请确认后端已启动，或检查安全软件是否拦截了本地后台进程。详情可查看桌面端日志与 backend.err.log。原始错误：' + (error.message || error));
  }
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text || response.statusText }; }
  if (!response.ok) throw new Error(data.error || '请求失败：HTTP ' + response.status);
  return data;
}

async function apiPost(path, body = {}) {
  return api(path, { method: 'POST', body: JSON.stringify(body) });
}
