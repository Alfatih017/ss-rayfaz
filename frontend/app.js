const $ = (s, r=document) => r.querySelector(s);
const h = (tag, props={}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
};

const api = {
  async req(method, url, body) {
    const r = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin'
    });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!r.ok) {
      const msg = data?.error?.message || data?.error || data?.body?.error?.message || `HTTP ${r.status}`;
      throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
    return data;
  },
  get: (u) => api.req('GET', u),
  post: (u, b) => api.req('POST', u, b),
  put: (u, b) => api.req('PUT', u, b),
  del: (u) => api.req('DELETE', u)
};

let toastTimer;
function toast(msg, kind='') {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = h('div', { class: `toast ${kind}` }, msg);
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3500);
}

const state = {
  me: null,
  tokens: [],
  view: 'swap',
  activeShift: null,
  pollTimer: null,
  prefillSwap: null,
  sessionUnlocked: false
};

async function loadTokens() {
  state.tokens = await api.get('/api/tokens');
}

const tokenLabel = (t) => t.label || `${t.coin} · ${t.network}`;

function tokenSelect(value, onchange) {
  const sel = h('select', { onchange });
  for (const t of state.tokens) {
    const opt = h('option', { value: `${t.coin}:${t.network}` }, tokenLabel(t));
    if (value === `${t.coin}:${t.network}`) opt.selected = true;
    sel.appendChild(opt);
  }
  return sel;
}

function brandMark() {
  return h('div', { class: 'brand' },
    h('span', {}, 'rayfaz'),
    h('span', { class: 'accent' }, '.swap')
  );
}

function nav() {
  const links = [
    { id: 'swap', label: 'Swap' },
    { id: 'bulk', label: 'Bulk' },
    { id: 'wallets', label: 'Wallets' },
    { id: 'history', label: 'History' }
  ];
  if (state.me?.isAdmin) links.push({ id: 'admin', label: 'Tokens' });
  links.push({ id: 'account', label: 'Account' });

  const unlockBadge = state.me?.isAdmin
    ? h('span', {
        class: `unlock-badge ${state.sessionUnlocked ? 'unlocked' : 'locked'}`,
        title: state.sessionUnlocked ? 'Wallet session unlocked — auto-sweep ready' : 'Wallet session locked — tap to unlock',
        onclick: async () => {
          if (state.sessionUnlocked) {
            await api.post('/api/wallets/session-lock');
            state.sessionUnlocked = false;
            toast('Wallet session locked', 'success');
            render();
          } else {
            const password = prompt('Enter account password to unlock wallet session for auto-sweep:');
            if (!password) return;
            try {
              await api.post('/api/wallets/session-unlock', { password });
              state.sessionUnlocked = true;
              toast('Wallet session unlocked for 30 minutes', 'success');
              render();
            } catch (e) { toast(e.message, 'error'); }
          }
        }
      }, state.sessionUnlocked ? '🔓 Unlocked' : '🔒 Locked')
    : null;

  return h('div', { class: 'nav' },
    brandMark(),
    h('div', { class: 'links' },
      ...links.map(l => h('a', {
        class: state.view === l.id ? 'active' : '',
        onclick: () => { state.view = l.id; render(); }
      }, l.label))
    ),
    unlockBadge,
    h('div', { class: 'user' },
      h('span', { class: 'dot' }),
      state.me?.username || ''
    ),
    h('button', { class: 'ghost', onclick: logout }, 'Sign out')
  );
}

async function logout() {
  await api.post('/api/auth/logout');
  state.me = null;
  state.view = 'swap';
  render();
}

function loginView() {
  const userInput = h('input', { type: 'text', autocomplete: 'username', required: true, placeholder: 'username' });
  const passInput = h('input', { type: 'password', autocomplete: 'current-password', required: true, placeholder: 'password' });
  const submit = h('button', { type: 'submit', style: 'width:100%; padding:16px;' }, 'Enter');

  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      submit.disabled = true;
      submit.textContent = 'Authenticating…';
      try {
        await api.post('/api/auth/login', {
          username: userInput.value,
          password: passInput.value
        });
        await init();
      } catch (err) {
        toast(err.message, 'error');
        submit.disabled = false;
        submit.textContent = 'Enter';
      }
    }
  },
    h('div', { class: 'card' },
      h('div', { class: 'logo' },
        h('div', { class: 'mark' },
          h('span', {}, 'rayfaz'),
          h('span', { class: 'accent' }, '.swap')
        ),
        h('div', { class: 'tag' }, 'Private Crypto Exchange')
      ),
      h('div', { style: 'margin-bottom:14px' },
        h('label', {}, 'Username'),
        userInput
      ),
      h('div', { style: 'margin-bottom:24px' },
        h('label', {}, 'Password'),
        passInput
      ),
      submit
    )
  );

  return h('div', { class: 'login-wrap' }, form);
}

function swapView() {
  if (!state.tokens.length) {
    return h('div', { class: 'container' },
      h('div', { class: 'card' },
        h('div', { class: 'eyebrow' }, 'Empty'),
        h('h1', {}, 'No tokens configured'),
        h('div', { class: 'muted', style: 'margin-top:10px' },
          'Ask an admin to enable tokens from the Tokens panel.')
      )
    );
  }

  let mode = 'variable';
  let inputCurrency = 'coin';
  const prefill = state.prefillSwap;
  state.prefillSwap = null;

  const findToken = (coin, network) => {
    if (!coin || !network) return null;
    const m = state.tokens.find(t =>
      t.coin.toUpperCase() === coin.toUpperCase() &&
      t.network.toLowerCase() === network.toLowerCase());
    return m ? `${m.coin}:${m.network}` : null;
  };
  const defaultFrom = `${state.tokens[0].coin}:${state.tokens[0].network}`;
  const defaultTo = state.tokens[1] ? `${state.tokens[1].coin}:${state.tokens[1].network}` : defaultFrom;
  const prefillTo = findToken(prefill?.settleCoin, prefill?.settleNetwork);
  let from = (prefillTo && prefillTo === defaultFrom)
    ? (state.tokens[1] ? `${state.tokens[1].coin}:${state.tokens[1].network}` : defaultFrom)
    : defaultFrom;
  let to = prefillTo || defaultTo;
  let amount = '';
  let pairData = null;
  let fromUsdPrice = null;

  let toUsdPrice = null;

  const fromSel = tokenSelect(from, async (e) => {
    from = e.target.value; fromUsdPrice = null;
    await loadFromUsdPrice(); refreshPair();
  });
  const toSel = tokenSelect(to, async (e) => {
    to = e.target.value; toUsdPrice = null;
    await loadToUsdPrice(); refreshPair();
  });

  const amountInput = h('input', {
    class: 'amt', type: 'number', step: 'any', placeholder: '0.00',
    oninput: (e) => { amount = e.target.value; updateAmountSubLabel(); refreshPair(); }
  });
  const estOutput = h('input', { class: 'amt', type: 'text', placeholder: '0.00', readonly: true });
  const settleAddrInput = h('input', { type: 'text', placeholder: 'Destination address' });
  if (prefill?.settleAddress) settleAddrInput.value = prefill.settleAddress;
  const settleAddrLabel = h('div', { class: 'muted', style: 'font-size:11px; margin-top:4px;' }, '');
  async function loadRotationAddress() {
    if (!state.me?.isAdmin) return;
    try {
      const r = await api.get('/api/wallets/rotation/next');
      settleAddrInput.value = r.publicKey;
      settleAddrInput.readOnly = true;
      settleAddrLabel.textContent = `🔄 Rotasi #${r.nextIndex + 1}/${r.poolSize} · ${r.label || 'Unlabeled'}`;
    } catch {
      settleAddrLabel.textContent = '';
    }
  }
  const refundAddrInput = h('input', { type: 'text', placeholder: 'Refund address (recommended)' });
  const memoInput = h('input', { type: 'text', placeholder: 'Destination memo (optional)' });

  const coinBtn = h('button', { onclick: () => setCurrency('coin') }, 'COIN');
  const usdBtn = h('button', { onclick: () => setCurrency('usd') }, 'USD');
  const currencyToggle = h('div', { class: 'currency-toggle' }, coinBtn, usdBtn);
  function setCurrency(c) {
    if (c === inputCurrency) return;
    if (amount && fromUsdPrice) {
      if (c === 'usd' && inputCurrency === 'coin') {
        amount = (Number(amount) * fromUsdPrice).toFixed(2);
      } else if (c === 'coin' && inputCurrency === 'usd') {
        amount = (Number(amount) / fromUsdPrice).toFixed(8);
      }
      amountInput.value = amount;
    }
    inputCurrency = c;
    coinBtn.classList.toggle('active', c === 'coin');
    usdBtn.classList.toggle('active', c === 'usd');
    updateAmountUiHints();
    refreshPair();
  }

  const amountPrefix = h('span', { class: 'amt-prefix' }, '');
  const amountSubLabel = h('div', { class: 'amt-sublabel' }, '');
  const minBtn = h('button', { class: 'mini-btn', type: 'button', onclick: useMin, title: 'Use minimum + buffer' }, 'MIN');

  function updateAmountUiHints() {
    const [fc] = from.split(':');
    if (inputCurrency === 'usd') {
      amountPrefix.textContent = '$';
      amountInput.placeholder = '0.00';
    } else {
      amountPrefix.textContent = '';
      amountInput.placeholder = `0.00 ${fc}`;
    }
    updateAmountSubLabel();
  }

  function updateAmountSubLabel() {
    const [fc] = from.split(':');
    if (!amount || !fromUsdPrice) {
      amountSubLabel.textContent = inputCurrency === 'usd' ? '' : '';
      return;
    }
    const n = Number(amount);
    if (inputCurrency === 'coin') {
      const usd = n * fromUsdPrice;
      amountSubLabel.textContent = `≈ $${usd.toFixed(2)} USD`;
    } else {
      const coin = n / fromUsdPrice;
      amountSubLabel.textContent = `≈ ${coin.toFixed(8)} ${fc}`;
    }
  }

  const estSubLabel = h('div', { class: 'amt-sublabel' }, '');

  async function loadFromUsdPrice() {
    const [fc, fn] = from.split(':');
    try {
      const r = await api.get(`/api/usd-price?coin=${encodeURIComponent(fc)}&network=${encodeURIComponent(fn)}`);
      fromUsdPrice = Number(r.usd);
    } catch { fromUsdPrice = null; }
    updateAmountSubLabel();
  }

  async function loadToUsdPrice() {
    const [tc, tn] = to.split(':');
    try {
      const r = await api.get(`/api/usd-price?coin=${encodeURIComponent(tc)}&network=${encodeURIComponent(tn)}`);
      toUsdPrice = Number(r.usd);
    } catch { toUsdPrice = null; }
    updateEstSubLabel();
  }

  function updateEstSubLabel() {
    if (!estOutput.value || !toUsdPrice) {
      estSubLabel.textContent = '';
      return;
    }
    const usd = Number(estOutput.value) * toUsdPrice;
    estSubLabel.textContent = `≈ $${usd.toFixed(2)} USD`;
  }

  function getCoinAmount() {
    if (!amount) return '';
    if (inputCurrency === 'coin') return amount;
    if (!fromUsdPrice) return '';
    return (Number(amount) / fromUsdPrice).toFixed(8);
  }

  function useMin() {
    if (!pairData?.min) return toast('Min not loaded yet, wait a moment', 'error');
    const [fc] = from.split(':');
    let minCoin = Number(pairData.min);
    if (fc.toUpperCase() === 'SOL') minCoin += 0.0003;
    else minCoin += minCoin * 0.005;
    const formatted = minCoin.toFixed(8);
    if (inputCurrency === 'usd' && fromUsdPrice) {
      amount = (minCoin * fromUsdPrice).toFixed(2);
    } else {
      amount = formatted;
    }
    amountInput.value = amount;
    refreshPair();
  }

  const rateBox = h('div', { class: 'rate-info' }, h('span', {}, 'Select an amount to view rate'));
  const result = h('div');

  const variableBtn = h('button', { onclick: () => setMode('variable') }, 'Variable Rate');
  const fixedBtn = h('button', { onclick: () => setMode('fixed') }, 'Fixed Rate · 15min');
  const modeBox = h('div', { class: 'swap-mode' }, variableBtn, fixedBtn);
  function setMode(m) {
    mode = m;
    variableBtn.classList.toggle('active', m === 'variable');
    fixedBtn.classList.toggle('active', m === 'fixed');
  }
  setMode('variable');

  async function refreshPair() {
    estOutput.value = '';
    if (!from || !to || from === to) {
      rateBox.innerHTML = '';
      rateBox.appendChild(h('span', {}, from === to ? 'Choose different tokens' : 'Pick a pair'));
      return;
    }
    const [fc, fn] = from.split(':');
    const [tc, tn] = to.split(':');
    rateBox.innerHTML = '';
    rateBox.appendChild(h('span', {}, 'Loading rate…'));
    try {
      const coinAmt = getCoinAmount();
      const params = new URLSearchParams({ from: `${fc}-${fn}`, to: `${tc}-${tn}` });
      if (coinAmt) params.set('amount', coinAmt);
      const pair = await api.get('/api/pair?' + params);
      pairData = pair;
      const rate = Number(pair.rate);
      const minStr = `${pair.min} ${fc}` + (fromUsdPrice ? ` ≈ $${(Number(pair.min) * fromUsdPrice).toFixed(2)}` : '');
      const maxStr = `${pair.max} ${fc}`;
      rateBox.innerHTML = '';
      rateBox.appendChild(h('span', {}, '1 ', h('b', {}, fc), ' ≈ ', h('span', { class: 'gold' }, rate.toFixed(8)), ' ', h('b', {}, tc)));
      rateBox.appendChild(h('span', {}, 'Min ', h('b', {}, minStr), ' · Max ', h('b', {}, maxStr)));
      if (coinAmt && rate) estOutput.value = (Number(coinAmt) * rate).toFixed(8);
      updateAmountSubLabel();
      updateEstSubLabel();
    } catch (e) {
      pairData = null;
      rateBox.innerHTML = '';
      rateBox.appendChild(h('span', { style: 'color:var(--danger)' }, 'Rate unavailable: ' + e.message));
    }
  }

  function swapDirection() {
    [from, to] = [to, from];
    [fromUsdPrice, toUsdPrice] = [toUsdPrice, fromUsdPrice];
    fromSel.value = from; toSel.value = to;
    updateAmountUiHints();
    refreshPair();
  }

  async function createShift() {
    const settleAddress = settleAddrInput.value.trim();
    if (!settleAddress) return toast('Enter destination address', 'error');
    const [fc, fn] = from.split(':');
    const [tc, tn] = to.split(':');
    const coinAmt = getCoinAmount();

    try {
      let shift;
      if (mode === 'fixed') {
        if (!coinAmt) return toast('Amount required for fixed rate', 'error');
        const quote = await api.post('/api/quote', {
          depositCoin: fc, depositNetwork: fn,
          settleCoin: tc, settleNetwork: tn,
          depositAmount: coinAmt
        });
        shift = await api.post('/api/shifts/fixed', {
          quoteId: quote.id, settleAddress,
          refundAddress: refundAddrInput.value.trim() || undefined,
          settleMemo: memoInput.value.trim() || undefined
        });
      } else {
        shift = await api.post('/api/shifts/variable', {
          depositCoin: fc, depositNetwork: fn,
          settleCoin: tc, settleNetwork: tn,
          settleAddress,
          refundAddress: refundAddrInput.value.trim() || undefined,
          settleMemo: memoInput.value.trim() || undefined
        });
      }
      state.activeShift = shift;
      result.innerHTML = '';
      result.appendChild(renderShiftBox(shift));
      pollShift(shift.id);
      toast('Shift created — send your deposit', 'success');
      result.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  setCurrency('coin');
  Promise.all([loadFromUsdPrice(), loadToUsdPrice()]).then(refreshPair);
  loadRotationAddress();

  return h('div', { class: 'container' },
    h('div', { class: 'card' },
      h('div', { class: 'eyebrow' }, 'Exchange'),
      h('h1', {}, 'Swap with assured custody'),
      h('div', { class: 'muted', style: 'margin: 6px 0 26px;' },
        'Direct-to-wallet shifts. No deposits held by us.'),
      modeBox,
      h('div', { class: 'swap-field' },
        h('div', { class: 'field-head' },
          h('label', { style: 'margin:0' }, 'You send'),
          h('div', { class: 'field-tools' }, minBtn, currencyToggle)
        ),
        h('div', { class: 'swap-field-inner' },
          h('div', { class: 'amt-wrap' }, amountPrefix, amountInput),
          fromSel
        ),
        amountSubLabel
      ),
      h('div', { class: 'swap-arrow-wrap' },
        h('div', { class: 'swap-arrow', onclick: swapDirection, title: 'Swap direction' }, '↓')
      ),
      h('div', { class: 'swap-field' },
        h('label', {}, 'You receive (estimated)'),
        h('div', { class: 'swap-field-inner' }, estOutput, toSel),
        estSubLabel
      ),
      rateBox,
      h('div', { class: 'field-group' },
        h('label', {}, 'Destination address'),
        settleAddrInput,
        settleAddrLabel
      ),
      h('div', { class: 'field-group' },
        h('label', {}, 'Refund address'),
        refundAddrInput
      ),
      h('div', { class: 'field-group' },
        h('label', {}, 'Destination memo'),
        memoInput
      ),
      h('div', { class: 'actions' },
        h('button', { onclick: createShift },
          mode === 'fixed' ? 'Lock Rate & Continue' : 'Generate Address')
      )
    ),
    result
  );
}

function renderShiftBox(s) {
  const fmtDate = (d) => d ? new Date(d).toLocaleString() : '—';
  return h('div', { class: 'card' },
    h('div', { class: 'eyebrow' }, `Shift · ${s.type}`),
    h('h1', { style: 'font-size: 22px;' }, 'Awaiting deposit'),
    h('div', { style: 'margin-top: 10px;' },
      h('span', { class: `status ${s.status || 'waiting'}` }, s.status || 'waiting')
    ),
    h('div', { class: 'deposit-box' },
      h('div', { class: 'dep-label' }, `Send ${s.depositCoin} on ${s.depositNetwork}`),
      h('div', { class: 'value' }, s.depositAddress || '—'),
      s.depositMemo ? h('div', { class: 'dep-label' }, 'Required memo') : null,
      s.depositMemo ? h('div', { class: 'value' }, s.depositMemo) : null,
      s.type === 'fixed'
        ? h('div', { class: 'summary-row' },
            h('span', { class: 'k' }, 'Exact amount'),
            h('span', { class: 'v' }, `${s.depositAmount} ${s.depositCoin}`))
        : h('div', { class: 'summary-row' },
            h('span', { class: 'k' }, 'Range'),
            h('span', { class: 'v' }, `${s.depositMin} — ${s.depositMax} ${s.depositCoin}`)),
      s.type === 'fixed' ? h('div', { class: 'summary-row' },
        h('span', { class: 'k' }, 'Expires'),
        h('span', { class: 'v' }, fmtDate(s.expiresAt))) : null,
      h('button', {
        class: 'copy-btn',
        onclick: () => {
          navigator.clipboard.writeText(s.depositAddress || '');
          toast('Address copied', 'success');
        }
      }, 'Copy address')
    ),
    h('div', { class: 'divider' }),
    h('div', { class: 'summary-row' },
      h('span', { class: 'k' }, 'Destination'),
      h('span', { class: 'v', style: 'font-family: ui-monospace, monospace; font-size: 12px;' }, s.settleAddress)
    ),
    h('div', { class: 'summary-row' },
      h('span', { class: 'k' }, 'Shift ID'),
      h('span', { class: 'v', style: 'font-family: ui-monospace, monospace; font-size: 12px;' }, s.id)
    )
  );
}

function pollShift(id) {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = setInterval(async () => {
    try {
      const s = await api.get('/api/shifts/' + id);
      state.activeShift = s;
      if (state.view === 'swap') {
        const cards = document.querySelectorAll('.container .card');
        if (cards.length > 1) {
          const fresh = renderShiftBox(s);
          cards[1].replaceWith(fresh);
        }
      }
      if (['settled', 'refunded', 'expired'].includes(s.status)) {
        clearInterval(state.pollTimer);
      }
    } catch (e) { /* ignore */ }
  }, 8000);
}

async function historyView() {
  const wrap = h('div', { class: 'container wide' },
    h('div', { class: 'card' },
      h('div', { class: 'eyebrow' }, 'Activity'),
      h('h1', {}, 'Transaction History'),
      h('div', { style: 'height: 24px' }),
      h('div', { id: 'hist-table' }, h('div', { class: 'muted' }, 'Loading…'))
    )
  );
  try {
    const rows = await api.get('/api/shifts');
    const target = wrap.querySelector('#hist-table');
    target.innerHTML = '';
    if (!rows.length) {
      target.appendChild(h('div', { class: 'muted' }, 'No transactions yet.'));
      return wrap;
    }
    const table = h('table', {},
      h('thead', {}, h('tr', {},
        h('th', {}, 'Date'),
        h('th', {}, 'Type'),
        h('th', {}, 'From'),
        h('th', {}, 'To'),
        h('th', {}, 'Amount'),
        h('th', {}, 'Status'),
        h('th', {}, 'ID')
      )),
      h('tbody', {}, ...rows.map(r => h('tr', {},
        h('td', {}, new Date(r.created_at).toLocaleString()),
        h('td', { class: 'muted' }, r.type),
        h('td', {}, `${r.deposit_coin} · ${r.deposit_network}`),
        h('td', {}, `${r.settle_coin} · ${r.settle_network}`),
        h('td', {}, r.deposit_amount ? `${r.deposit_amount} ${r.deposit_coin}` : '—'),
        h('td', {}, h('span', { class: `status ${r.status || ''}` }, r.status || '—')),
        h('td', {}, h('a', { onclick: () => viewShift(r.shift_id), style: 'cursor:pointer; font-family: ui-monospace, monospace; font-size: 12px;' },
          r.shift_id.slice(0, 10) + '…'))
      )))
    );
    target.appendChild(table);
  } catch (e) {
    wrap.querySelector('#hist-table').innerHTML = '';
    wrap.querySelector('#hist-table').appendChild(h('div', { class: 'muted' }, 'Error: ' + e.message));
  }
  return wrap;
}

async function viewShift(id) {
  try {
    const s = await api.get('/api/shifts/' + id);
    state.activeShift = s;
    state.view = 'swap';
    render();
    setTimeout(() => {
      const c = $('.container');
      if (c) c.appendChild(renderShiftBox(s));
    }, 50);
    pollShift(id);
  } catch (e) { toast(e.message, 'error'); }
}

async function adminView() {
  const wrap = h('div', { class: 'container wide' },
    h('div', { class: 'card' },
      h('div', { class: 'eyebrow' }, 'Admin'),
      h('h1', {}, 'Token Catalog'),
      h('div', { class: 'muted', style: 'margin: 6px 0 24px' },
        'Coin = SideShift ticker (e.g. SOL, USDT). Network = id (solana, bsc, polygon).'),
      h('div', { id: 'token-list' }, h('div', { class: 'muted' }, 'Loading…')),
      h('div', { class: 'divider' }),
      h('h2', { style: 'margin-bottom:14px' }, 'Add Token'),
      (() => {
        const coin = h('input', { placeholder: 'COIN' });
        const net = h('input', { placeholder: 'network' });
        const lbl = h('input', { placeholder: 'Label (optional)' });
        const ord = h('input', { type: 'number', value: 99, placeholder: 'order' });
        const en = h('input', { type: 'checkbox', checked: true });
        const btn = h('button', { onclick: async () => {
          if (!coin.value || !net.value) return toast('Coin and network required', 'error');
          try {
            await api.post('/api/admin/tokens', {
              coin: coin.value, network: net.value, label: lbl.value,
              enabled: en.checked ? 1 : 0, sort_order: Number(ord.value || 0)
            });
            toast('Added', 'success');
            await loadTokens(); render();
          } catch (e) { toast(e.message, 'error'); }
        }}, 'Add');
        return h('div', { class: 'token-row' }, coin, net, lbl, ord, en, btn);
      })()
    )
  );

  try {
    const list = await api.get('/api/admin/tokens');
    const target = wrap.querySelector('#token-list');
    target.innerHTML = '';
    target.appendChild(h('div', { class: 'token-row', style: 'border-bottom-color: transparent; padding-bottom: 4px;' },
      h('div', { class: 'muted' }, 'Coin'),
      h('div', { class: 'muted' }, 'Network'),
      h('div', { class: 'muted' }, 'Label'),
      h('div', { class: 'muted' }, 'Order'),
      h('div', { class: 'muted' }, 'On'),
      h('div', {})
    ));
    for (const t of list) {
      const coin = h('input', { value: t.coin });
      const net = h('input', { value: t.network });
      const lbl = h('input', { value: t.label || '' });
      const ord = h('input', { type: 'number', value: t.sort_order });
      const en = h('input', { type: 'checkbox' });
      en.checked = !!t.enabled;
      const save = h('button', { class: 'ghost', style: 'padding: 9px 14px; font-size: 11px;', onclick: async () => {
        try {
          await api.put('/api/admin/tokens/' + t.id, {
            coin: coin.value, network: net.value, label: lbl.value,
            enabled: en.checked ? 1 : 0, sort_order: Number(ord.value || 0)
          });
          toast('Saved', 'success');
          await loadTokens();
        } catch (e) { toast(e.message, 'error'); }
      }}, 'Save');
      const del = h('button', { class: 'danger', style: 'padding: 9px 14px; font-size: 11px;', onclick: async () => {
        if (!confirm('Delete this token?')) return;
        await api.del('/api/admin/tokens/' + t.id);
        await loadTokens(); render();
      }}, 'Del');
      const actions = h('div', { style: 'display:flex; gap:6px;' }, save, del);
      target.appendChild(h('div', { class: 'token-row' }, coin, net, lbl, ord, en, actions));
    }
  } catch (e) {
    wrap.querySelector('#token-list').innerHTML = '';
    wrap.querySelector('#token-list').appendChild(h('div', { class: 'muted' }, 'Error: ' + e.message));
  }
  return wrap;
}

async function bulkView() {
  const settingsKey = 'ss-rayfaz-bulk-settings';
  const loadSettings = () => {
    try { return JSON.parse(localStorage.getItem(settingsKey) || '{}'); }
    catch { return {}; }
  };
  const saveSettings = (s) => localStorage.setItem(settingsKey, JSON.stringify(s));
  let settings = loadSettings();

  const settingsCard = (() => {
    const fromCoin = settings.depositCoin || (state.tokens[0]?.coin || '');
    const fromNet = settings.depositNetwork || (state.tokens[0]?.network || '');
    const fromVal = `${fromCoin}:${fromNet}`;

    const fromSel = tokenSelect(fromVal, (e) => {
      const [c, n] = e.target.value.split(':');
      settings.depositCoin = c;
      settings.depositNetwork = n;
    });
    const modeSel = h('select', {
      onchange: (e) => { settings.mode = e.target.value; }
    },
      h('option', { value: 'variable' }, 'Variable Rate (no fixed amount)'),
      h('option', { value: 'fixed' }, 'Fixed Rate · 15min')
    );
    modeSel.value = settings.mode || 'variable';

    const currencySel = h('select', {
      onchange: (e) => { settings.currency = e.target.value; updateAmtPrefix(); }
    },
      h('option', { value: 'coin' }, 'COIN'),
      h('option', { value: 'usd' }, 'USD')
    );
    currencySel.value = settings.currency || 'coin';

    const amtPrefix = h('span', { class: 'amt-prefix-inline' }, '');
    const amtInput = h('input', {
      type: 'number', step: 'any', placeholder: '0.00',
      value: settings.amount || '',
      oninput: (e) => { settings.amount = e.target.value; }
    });
    function updateAmtPrefix() {
      amtPrefix.textContent = currencySel.value === 'usd' ? '$' : '';
    }
    updateAmtPrefix();

    const refundInput = h('input', {
      type: 'text',
      placeholder: 'Refund address (optional)',
      value: settings.refundAddress || '',
      oninput: (e) => { settings.refundAddress = e.target.value; }
    });

    const saveBtn = h('button', { onclick: () => {
      if (!settings.depositCoin || !settings.depositNetwork) {
        const v = fromSel.value.split(':');
        settings.depositCoin = v[0];
        settings.depositNetwork = v[1];
      }
      settings.mode = modeSel.value;
      settings.currency = currencySel.value;
      saveSettings(settings);
      toast('Settings saved', 'success');
      updateStatus();
    }}, 'Save Settings');

    const status = h('div', { class: 'muted', style: 'margin-top: 10px; font-size: 12px;' });
    function updateStatus() {
      const s = loadSettings();
      if (!s.depositCoin) {
        status.textContent = 'Not configured yet — set deposit token, then Save.';
        return;
      }
      const amtLine = s.amount
        ? `${s.amount} ${s.currency === 'usd' ? 'USD' : s.depositCoin}`
        : (s.mode === 'variable' ? '(no amount — user-defined)' : 'amount required for fixed');
      status.textContent = `Active: ${s.depositCoin}·${s.depositNetwork} → SOL · ${s.mode || 'variable'} · ${amtLine}`;
    }
    updateStatus();

    return h('div', { class: 'card' },
      h('div', { class: 'eyebrow' }, 'Configuration'),
      h('h2', { style: 'margin-bottom: 18px;' }, 'Bulk Swap Settings'),
      h('div', { class: 'muted', style: 'margin-bottom: 18px;' },
        'These settings apply when you click Swap on any wallet below. Destination is always the wallet\'s SOL address on Solana.'),
      h('div', { class: 'row', style: 'flex-wrap: wrap;' },
        h('div', { style: 'min-width: 220px;' }, h('label', {}, 'Deposit token (you send)'), fromSel),
        h('div', { style: 'min-width: 200px;' }, h('label', {}, 'Mode'), modeSel)
      ),
      h('div', { class: 'row', style: 'margin-top: 14px; flex-wrap: wrap;' },
        h('div', { style: 'min-width: 140px; max-width: 160px;' }, h('label', {}, 'Currency'), currencySel),
        h('div', {},
          h('label', {}, 'Amount per swap'),
          h('div', { class: 'amt-inline-wrap' }, amtPrefix, amtInput)
        )
      ),
      h('div', { style: 'margin-top: 14px;' },
        h('label', {}, 'Refund address (optional, used for all bulk swaps)'),
        refundInput
      ),
      h('div', { style: 'margin-top: 18px;' }, saveBtn),
      status
    );
  })();

  const wrap = h('div', { class: 'container wide' },
    settingsCard,
    h('div', { class: 'card' },
      h('div', { class: 'eyebrow' }, 'Bulk Operations'),
      h('h1', {}, 'Solana Wallet Pool'),
      h('div', { class: 'muted', style: 'margin: 6px 0 24px' },
        'Generate Solana wallets for batch swaps. Private keys are encrypted at rest.'),
      (() => {
        const count = h('input', { type: 'number', value: 1, min: 1, max: 100 });
        const prefix = h('input', { value: 'wallet', placeholder: 'label prefix' });
        const btn = h('button', { onclick: async () => {
          btn.disabled = true; btn.textContent = 'Generating…';
          try {
            const r = await api.post('/api/wallets/generate', {
              count: Number(count.value || 1),
              label_prefix: prefix.value || 'wallet'
            });
            toast(`Created ${r.created.length} wallet(s)`, 'success');
            await refreshList();
          } catch (e) { toast(e.message, 'error'); }
          btn.disabled = false; btn.textContent = 'Generate';
        }}, 'Generate');
        return h('div', { class: 'gen-row' },
          h('div', {}, h('label', {}, 'How many'), count),
          h('div', {}, h('label', {}, 'Label prefix'), prefix),
          h('div', { style: 'align-self: end' }, btn)
        );
      })(),
      h('div', { class: 'divider' }),
      h('div', { class: 'wallet-toolbar' },
        h('h2', { style: 'margin: 0' }, 'Wallets'),
        (() => {
          const exportBtn = h('button', { class: 'ghost', style: 'padding: 8px 14px; font-size: 11px;', onclick: async () => {
            try {
              const list = await api.get('/api/wallets');
              if (!list.length) return toast('No wallets to export', 'error');
              if (!confirm(`Export ${list.length} wallets WITH private keys to CSV?\n\nThe file will contain plaintext secrets — store it safely.`)) return;
              const password = prompt('Enter your account password to export private keys:');
              if (!password) return;
              const rows = [];
              for (const w of list) {
                const r = await api.post('/api/wallets/' + w.id + '/reveal', { password });
                rows.push([w.label || '', w.network, w.public_key, r.secret_key_base58]);
              }
              const csv = 'label,network,public_key,secret_key_base58\n' +
                rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
              const blob = new Blob([csv], { type: 'text/csv' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url; a.download = `wallets-${Date.now()}.csv`; a.click();
              URL.revokeObjectURL(url);
              toast('CSV downloaded', 'success');
            } catch (e) { toast(e.message, 'error'); }
          }}, 'Export CSV');
          return exportBtn;
        })()
      ),
      h('div', { id: 'wallet-list' }, h('div', { class: 'muted' }, 'Loading…'))
    )
  );

  async function executeBulkSwap(wallet) {
    const s = loadSettings();
    if (!s.depositCoin || !s.depositNetwork) {
      return toast('Configure swap settings first', 'error');
    }
    const settleCoin = 'SOL';
    const settleNetwork = wallet.network;
    const settleAddress = wallet.public_key;
    const refundAddress = s.refundAddress || undefined;

    let depositAmount;
    if (s.mode === 'fixed' || (s.amount && s.mode !== 'variable_no_amount')) {
      if (!s.amount) {
        if (s.mode === 'fixed') return toast('Amount required for fixed mode', 'error');
      } else {
        if (s.currency === 'usd') {
          try {
            const p = await api.get(`/api/usd-price?coin=${encodeURIComponent(s.depositCoin)}&network=${encodeURIComponent(s.depositNetwork)}`);
            depositAmount = (Number(s.amount) / Number(p.usd)).toFixed(8);
          } catch (e) { return toast('USD price unavailable: ' + e.message, 'error'); }
        } else {
          depositAmount = String(s.amount);
        }
      }
    }

    try {
      let shift;
      if (s.mode === 'fixed') {
        const quote = await api.post('/api/quote', {
          depositCoin: s.depositCoin, depositNetwork: s.depositNetwork,
          settleCoin, settleNetwork, depositAmount
        });
        shift = await api.post('/api/shifts/fixed', {
          quoteId: quote.id, settleAddress, refundAddress
        });
      } else {
        shift = await api.post('/api/shifts/variable', {
          depositCoin: s.depositCoin, depositNetwork: s.depositNetwork,
          settleCoin, settleNetwork, settleAddress, refundAddress
        });
      }
      showBulkShiftModal(shift, wallet);
    } catch (e) {
      toast('Shift failed: ' + e.message, 'error');
    }
  }

  async function refreshList() {
    const list = await api.get('/api/wallets');
    const target = wrap.querySelector('#wallet-list');
    target.innerHTML = '';
    if (!list.length) {
      target.appendChild(h('div', { class: 'muted', style: 'padding: 14px 0' }, 'No wallets yet. Generate one above.'));
      return;
    }
    const table = h('table', {},
      h('thead', {}, h('tr', {},
        h('th', {}, 'Label'),
        h('th', {}, 'Network'),
        h('th', {}, 'Public Key'),
        h('th', {}, 'Created'),
        h('th', {}, '')
      )),
      h('tbody', {}, ...list.map(w => {
        const labelInput = h('input', { value: w.label || '', style: 'padding: 6px 10px; font-size: 12px;' });
        const swapBtn = h('button', { style: 'padding: 7px 14px; font-size: 11px;', onclick: async () => {
          swapBtn.disabled = true; swapBtn.textContent = '...';
          await executeBulkSwap(w);
          swapBtn.disabled = false; swapBtn.textContent = 'Swap';
        }}, 'Swap');
        const tr = h('tr', {},
          h('td', {}, labelInput),
          h('td', { class: 'muted' }, w.network),
          h('td', {},
            h('span', { class: 'mono', title: w.public_key }, w.public_key.slice(0, 14) + '…' + w.public_key.slice(-6)),
            ' ',
            h('button', { class: 'mini-btn', style: 'margin-left: 8px', onclick: () => {
              navigator.clipboard.writeText(w.public_key);
              toast('Public key copied', 'success');
            }}, 'Copy')
          ),
          h('td', { class: 'muted' }, new Date(w.created_at).toLocaleString()),
          h('td', { style: 'white-space: nowrap; text-align: right;' },
            swapBtn,
            ' ',
            h('button', { class: 'ghost', style: 'padding: 7px 12px; font-size: 11px;', onclick: async () => {
              try {
                await api.put('/api/wallets/' + w.id, { label: labelInput.value });
                toast('Saved', 'success');
              } catch (e) { toast(e.message, 'error'); }
            }}, 'Save'),
            ' ',
            h('button', { class: 'ghost', style: 'padding: 7px 12px; font-size: 11px;', onclick: async () => {
              try {
                const password = prompt('Enter your account password to reveal this private key:');
                if (!password) return;
                const r = await api.post('/api/wallets/' + w.id + '/reveal', { password });
                showSecretModal(r);
              } catch (e) { toast(e.message, 'error'); }
            }}, 'Reveal'),
            ' ',
            h('button', { class: 'danger', style: 'padding: 7px 12px; font-size: 11px;', onclick: async () => {
              if (!confirm('Delete this wallet? Private key cannot be recovered after delete.')) return;
              try {
                await api.del('/api/wallets/' + w.id);
                await refreshList();
                toast('Deleted', 'success');
              } catch (e) { toast(e.message, 'error'); }
            }}, 'Delete')
          )
        );
        return tr;
      }))
    );
    target.appendChild(table);
  }

  refreshList();
  return wrap;
}

function showBulkShiftModal(s, wallet) {
  const overlay = h('div', { class: 'modal-overlay', onclick: (e) => {
    if (e.target === overlay) overlay.remove();
  }});
  const fmtDate = (d) => d ? new Date(d).toLocaleString() : '—';
  const box = h('div', { class: 'modal-box' },
    h('div', { class: 'eyebrow' }, `Shift Created · ${s.type}`),
    h('h1', { style: 'font-size: 22px;' }, 'Send Deposit'),
    h('div', { class: 'muted', style: 'margin: 6px 0 22px' },
      `Wallet: ${wallet.label || wallet.public_key.slice(0, 10) + '…'} · Status: `,
      h('span', { class: `status ${s.status || 'waiting'}` }, s.status || 'waiting')
    ),
    h('div', { class: 'dep-label' }, `Send ${s.depositCoin} on ${s.depositNetwork}`),
    h('div', { class: 'value' }, s.depositAddress || '—'),
    s.depositMemo ? h('div', { class: 'dep-label' }, 'Required memo') : null,
    s.depositMemo ? h('div', { class: 'value' }, s.depositMemo) : null,
    s.type === 'fixed'
      ? h('div', { class: 'summary-row' },
          h('span', { class: 'k' }, 'Exact amount'),
          h('span', { class: 'v' }, `${s.depositAmount} ${s.depositCoin}`))
      : h('div', { class: 'summary-row' },
          h('span', { class: 'k' }, 'Range'),
          h('span', { class: 'v' }, `${s.depositMin} — ${s.depositMax} ${s.depositCoin}`)),
    s.type === 'fixed' ? h('div', { class: 'summary-row' },
      h('span', { class: 'k' }, 'Expires'),
      h('span', { class: 'v' }, fmtDate(s.expiresAt))) : null,
    h('div', { class: 'summary-row' },
      h('span', { class: 'k' }, 'Receives at'),
      h('span', { class: 'v mono', style: 'font-size: 11px;' }, s.settleAddress)
    ),
    h('div', { style: 'display: flex; gap: 10px; margin-top: 20px;' },
      h('button', { class: 'copy-btn', onclick: () => {
        navigator.clipboard.writeText(s.depositAddress || '');
        toast('Deposit address copied', 'success');
      }}, 'Copy Deposit Address'),
      h('button', { class: 'ghost', onclick: () => overlay.remove() }, 'Close')
    )
  );
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

function showSecretModal(r) {
  const overlay = h('div', { class: 'modal-overlay', onclick: (e) => {
    if (e.target === overlay) overlay.remove();
  }});
  const arrText = '[' + r.secret_key_array.join(',') + ']';
  const box = h('div', { class: 'modal-box' },
    h('div', { class: 'eyebrow' }, 'Sensitive'),
    h('h1', { style: 'font-size: 22px;' }, 'Private Key Reveal'),
    h('div', { class: 'muted', style: 'margin: 6px 0 22px' },
      `Wallet: ${r.label || '(no label)'} · ${r.network}`),
    r.mnemonic ? h('div', { class: 'dep-label' }, 'Seed Phrase') : null,
    r.mnemonic ? h('div', { class: 'value secret-value' }, r.mnemonic) : null,
    r.mnemonic ? h('button', { class: 'copy-btn', onclick: () => navigator.clipboard.writeText(r.mnemonic) }, 'Copy Seed Phrase') : null,
    h('div', { class: 'dep-label' }, 'Public Key'),
    h('div', { class: 'value' }, r.public_key),
    h('div', { class: 'dep-label' }, 'Secret Key (Base58 — Phantom / Solflare)'),
    h('div', { class: 'value' }, r.secret_key_base58),
    h('button', { class: 'copy-btn', onclick: () => {
      navigator.clipboard.writeText(r.secret_key_base58);
      toast('Base58 secret copied', 'success');
    }}, 'Copy Base58'),
    h('div', { style: 'height: 14px' }),
    h('div', { class: 'dep-label' }, 'Secret Key (Byte Array — Solana CLI / scripts)'),
    h('div', { class: 'value', style: 'max-height: 100px; overflow: auto; font-size: 11px;' }, arrText),
    h('button', { class: 'copy-btn', onclick: () => {
      navigator.clipboard.writeText(arrText);
      toast('Byte array copied', 'success');
    }}, 'Copy Array'),
    h('div', { class: 'divider' }),
    h('div', { class: 'actions' },
      h('button', { class: 'ghost', onclick: () => overlay.remove() }, 'Close')
    )
  );
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

async function walletsView() {
  const wrap=h('div',{class:'container wide'},h('div',{class:'card'},h('div',{class:'eyebrow'},'Treasury'),h('h1',{},'Wallets'),h('div',{class:'muted',style:'margin:6px 0 22px'},'View SOL balances and transfer from any stored wallet on Solana mainnet-beta.'),h('div',{id:'wallet-balances'},h('div',{class:'muted'},'Loading…'))));
  const target=wrap.querySelector('#wallet-balances');
  try {
    const rows=await api.get('/api/wallets/balances');target.innerHTML='';
    if(!rows.length){target.appendChild(h('div',{class:'muted'},'No wallets configured.'));return wrap;}
    target.appendChild(h('div',{class:'wallet-grid'},...rows.map(w=>{
      const destination=h('input',{class:'mono',placeholder:'Destination Solana address'});const amount=h('input',{type:'number',min:'0.000000001',step:'0.000000001',placeholder:'SOL amount'});
      const send=h('button',{onclick:async()=>{const password=prompt('Enter account password to create a signed preview:');if(!password)return;send.disabled=true;try{const p=await api.post('/api/wallets/transfer/preview',{sourceWalletId:w.id,destination:destination.value.trim(),amountSol:amount.value,password});showTransferPreview(p);}catch(e){toast(e.message,'error');}finally{send.disabled=false;}}},'Preview Transfer');
      return h('div',{class:`wallet-card${w.is_main?' main-wallet':''}`},h('div',{class:'wallet-card-head'},h('div',{},h('div',{class:'eyebrow'},w.is_main?'Wallet Utama':'Wallet Tujuan Swap'),h('h2',{},w.label||'Unlabeled wallet')),w.is_main?h('span',{class:'status settled'},'MAIN'):null),h('div',{class:'value mono'},w.public_key),h('div',{class:'wallet-balance'},w.balanceSol===null?'Balance unavailable':`${w.balanceSol.toFixed(9)} SOL`),h('div',{class:'wallet-transfer-row'},destination,amount,send));
    })));
  } catch(e){target.innerHTML='';target.appendChild(h('div',{class:'muted'},'Unable to load wallet balances: '+e.message));}
  return wrap;
}

function showTransferPreview(p){
  const overlay=h('div',{class:'modal-overlay',onclick:e=>{if(e.target===overlay)overlay.remove();}});const box=h('div',{class:'modal-box'},h('div',{class:'eyebrow'},'Mainnet Transfer Preview'),h('h1',{style:'font-size:22px'},`${p.amountSol} SOL`),h('div',{class:'summary-row'},h('span',{class:'k'},'From'),h('span',{class:'v mono'},p.sourceAddress)),h('div',{class:'summary-row'},h('span',{class:'k'},'To'),h('span',{class:'v mono'},p.destination)),h('div',{class:'summary-row'},h('span',{class:'k'},'Estimated fee'),h('span',{class:'v'},`${p.feeSol} SOL`)),h('div',{class:'summary-row'},h('span',{class:'k'},'Remaining balance'),h('span',{class:'v'},`${p.balanceAfterSol} SOL`)),h('div',{class:'muted',style:'margin-top:12px'},`Expires ${new Date(p.expiresAt).toLocaleTimeString()}. Confirmation broadcasts real funds and cannot be undone.`),h('div',{class:'actions'},h('button',{class:'danger',onclick:async()=>{if(!confirm('Broadcast this irreversible SOL transfer on mainnet?'))return;const password=prompt('Re-enter account password to broadcast:');if(!password)return;try{const r=await api.post('/api/wallets/transfer/confirm',{previewToken:p.previewToken,password});toast('Transfer confirmed: '+r.signature.slice(0,12)+'…','success');overlay.remove();state.view='wallets';render();}catch(e){toast(e.message,'error');}}},'Confirm & Send'),h('button',{class:'ghost',onclick:()=>overlay.remove()},'Cancel')));overlay.appendChild(box);document.body.appendChild(overlay);
}

function accountView() {
  const cur = h('input', { type: 'password', placeholder: 'Current password' });
  const nx = h('input', { type: 'password', placeholder: 'New password (min 12 chars)' });
  const mnemonic = h('textarea', { rows: 4, autocomplete: 'off', spellcheck: 'false', placeholder: 'Enter a valid 12 or 24 word seed phrase' });
  const walletPassword = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Account password' });
  const walletStatus = h('div', { class: 'muted', style: 'margin-top:12px' }, 'Checking wallet settings…');
  const refreshWalletStatus = async () => { try { const s = await api.get('/api/settings/wallet'); walletStatus.textContent = s.configured ? `Configured · ${s.public_key}` : 'No seed wallet configured.'; } catch (e) { walletStatus.textContent = 'Unable to load wallet settings.'; } };
  refreshWalletStatus();
  return h('div', { class: 'container' },
    h('div', { class: 'card' },
      h('div', { class: 'eyebrow' }, 'Profile'),
      h('h1', {}, 'Account'),
      h('div', { class: 'muted', style: 'margin: 6px 0 28px' },
        `Signed in as ${state.me.username}${state.me.isAdmin ? ' · admin' : ''}`),
      h('h2', { style: 'margin-bottom:14px' }, 'Change Password'),
      h('div', { style: 'margin-bottom:12px' }, cur),
      h('div', { style: 'margin-bottom:18px' }, nx),
      h('button', { onclick: async () => {
        try {
          await api.post('/api/auth/change-password', { current: cur.value, next: nx.value });
          toast('Password updated', 'success');
          cur.value = ''; nx.value = '';
        } catch (e) { toast(e.message, 'error'); }
      }}, 'Update'),
      state.me.isAdmin ? h('div', { class: 'divider' }) : null,
      state.me.isAdmin ? h('h2', { style: 'margin-bottom:8px' }, 'Seed Wallet') : null,
      state.me.isAdmin ? h('div', { class: 'muted', style: 'margin-bottom:14px' }, 'The phrase and derived Solana private key are encrypted at rest. Derivation path: m/44′/501′/0′/0′.') : null,
      state.me.isAdmin ? h('div', { style: 'margin-bottom:12px' }, mnemonic) : null,
      state.me.isAdmin ? h('div', { style: 'margin-bottom:14px' }, walletPassword) : null,
      state.me.isAdmin ? h('div', { class: 'actions compact-actions' },
        h('button', { onclick: async () => { try { const r = await api.post('/api/settings/wallet', { mnemonic: mnemonic.value, password: walletPassword.value }); mnemonic.value=''; walletPassword.value=''; toast('Seed wallet saved securely', 'success'); await refreshWalletStatus(); } catch(e) { toast(e.message,'error'); } } }, 'Save Seed Wallet'),
        h('button', { class: 'ghost', onclick: async () => { const password=prompt('Enter your account password to reveal the seed and private key:'); if(!password)return; try { showSecretModal(await api.post('/api/settings/wallet/reveal',{password})); } catch(e){ toast(e.message,'error'); } } }, 'Reveal Secrets')
      ) : null,
      state.me.isAdmin ? walletStatus : null
    )
  );
}

async function render() {
  const root = $('#app');
  root.innerHTML = '';
  if (!state.me) {
    root.appendChild(loginView());
    return;
  }
  root.appendChild(nav());
  let view;
  if (state.view === 'swap') view = swapView();
  else if (state.view === 'bulk') view = await bulkView();
  else if (state.view === 'wallets') view = await walletsView();
  else if (state.view === 'history') view = await historyView();
  else if (state.view === 'admin' && state.me.isAdmin) view = await adminView();
  else if (state.view === 'account') view = accountView();
  else view = swapView();
  root.appendChild(view);
}

async function init() {
  try {
    const me = await api.get('/api/auth/me');
    if (me.authenticated) {
      state.me = me;
      await loadTokens();
      if (me.isAdmin) {
        try { const s = await api.get('/api/wallets/session-status'); state.sessionUnlocked = !!s.unlocked; } catch {}
      }
    }
  } catch {}
  render();
}

init();
