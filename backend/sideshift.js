const BASE = 'https://sideshift.ai/api/v2';

function headers(userIp) {
  const h = {
    'Content-Type': 'application/json',
    'x-sideshift-secret': process.env.SIDESHIFT_SECRET || ''
  };
  if (userIp) h['x-user-ip'] = userIp;
  return h;
}

async function call(method, path, body, userIp) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: headers(userIp),
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(data?.error?.message || `SideShift ${res.status}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

module.exports = {
  permissions: (ip) => call('GET', '/permissions', null, ip),
  pair: (from, to, amount) => {
    const q = amount ? `?amount=${encodeURIComponent(amount)}` : '';
    return call('GET', `/pair/${from}/${to}${q}`);
  },
  quote: (body, ip) => call('POST', '/quotes', body, ip),
  fixed: (body, ip) => call('POST', '/shifts/fixed', body, ip),
  variable: (body, ip) => call('POST', '/shifts/variable', body, ip),
  shift: (id) => call('GET', `/shifts/${id}`),
  setRefundAddress: (id, body) =>
    call('POST', `/shifts/${id}/set-refund-address`, body),
  cancel: (body) => call('POST', '/shifts/cancel', body)
};
