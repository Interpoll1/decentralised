/**
 * The lite client: create a poll, share it, vote, watch results, keep a receipt.
 *
 * No build step and no dependencies — it is served as-is by the relay, so a
 * self-hoster never has to run a bundler to get something usable.
 */

const view = document.getElementById('view');
const state = {
  instance: { name: 'Polls', accentColor: '#4f7cff', ttlHours: 24, ephemeral: false },
  identity: null,
  socket: null,
  currentPollId: null,
};

// ── Small helpers ────────────────────────────────────────────────────────────

const el = (tag, props = {}, children = []) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of [].concat(children)) {
    if (child != null) node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
};

async function api(path, options) {
  const res = await fetch(path, {
    headers: options?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  let body = null;
  try { body = await res.json(); } catch { /* empty or non-JSON response */ }
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return body;
}

function timeLeft(expiresAt) {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return 'closed';
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `closes in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `closes in ${hours} h`;
  return `closes in ${Math.round(hours / 24)} days`;
}

// ── Local history (this browser only) ────────────────────────────────────────

const HISTORY_KEY = 'lite_polls';
const VOTES_KEY = 'lite_votes';

function readStore(key) {
  try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; }
}
function writeStore(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

function rememberPoll(poll) {
  const all = readStore(HISTORY_KEY);
  all[poll.id] = { id: poll.id, question: poll.question, createdAt: poll.createdAt, expiresAt: poll.expiresAt };
  writeStore(HISTORY_KEY, all);
}
function rememberVote(pollId, optionIds, receipt) {
  const all = readStore(VOTES_KEY);
  all[pollId] = { optionIds, receipt, at: Date.now() };
  writeStore(VOTES_KEY, all);
}
const myVote = pollId => readStore(VOTES_KEY)[pollId] || null;

// ── Device identity ──────────────────────────────────────────────────────────

const KEY_STORAGE = 'lite_identity';

/**
 * An ECDSA P-256 key pair kept in localStorage. It is what makes a receipt mean
 * something: the vote is signed by this device, so the receipt can be checked
 * later against the signature rather than taken on trust.
 */
async function loadIdentity() {
  const subtle = window.crypto?.subtle;
  if (!subtle) return { deviceId: fallbackDeviceId(), publicKey: '', sign: async () => '' };

  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(KEY_STORAGE) || 'null'); } catch { /* corrupt */ }

  let keyPair;
  if (stored) {
    keyPair = {
      privateKey: await subtle.importKey('jwk', stored.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']),
      publicKey: await subtle.importKey('jwk', stored.publicJwk, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']),
    };
  } else {
    keyPair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    writeStoreRaw(KEY_STORAGE, {
      privateJwk: await subtle.exportKey('jwk', keyPair.privateKey),
      publicJwk: await subtle.exportKey('jwk', keyPair.publicKey),
    });
  }

  const raw = new Uint8Array(await subtle.exportKey('raw', keyPair.publicKey));
  const publicKey = hex(raw);
  const digest = new Uint8Array(await subtle.digest('SHA-256', raw));
  return {
    deviceId: hex(digest).slice(0, 32),
    publicKey,
    async sign(payload) {
      const bytes = new TextEncoder().encode(JSON.stringify(payload));
      const signature = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, bytes);
      return hex(new Uint8Array(signature));
    },
  };
}

function writeStoreRaw(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}
const hex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');

function fallbackDeviceId() {
  let id = localStorage.getItem('lite_device') || '';
  if (!id) {
    id = hex(crypto.getRandomValues(new Uint8Array(16)));
    try { localStorage.setItem('lite_device', id); } catch { /* private mode */ }
  }
  return id;
}

// ── Live updates ─────────────────────────────────────────────────────────────

function connect() {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
  const socket = new WebSocket(url);
  state.socket = socket;

  socket.addEventListener('open', () => {
    setConnection('online', 'live');
    socket.send(JSON.stringify({ type: 'register', peerId: `lite-${state.identity?.deviceId?.slice(0, 12) || 'anon'}` }));
    socket.send(JSON.stringify({ type: 'join-room', roomId: 'default' }));
  });

  socket.addEventListener('message', event => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === 'poll-updated' && message.data?.id === state.currentPollId) {
      renderPoll(state.currentPollId, { silent: true });
    }
  });

  socket.addEventListener('close', () => {
    setConnection('offline', 'reconnecting…');
    setTimeout(connect, 2000);
  });
  socket.addEventListener('error', () => setConnection('offline', 'offline'));
}

function setConnection(dotState, label) {
  document.querySelector('[data-conn-dot]').dataset.state = dotState;
  document.querySelector('[data-conn-label]').textContent = label;
}

// ── Views ────────────────────────────────────────────────────────────────────

function renderHome() {
  state.currentPollId = null;
  view.replaceChildren();

  view.append(
    el('h1', { textContent: 'Create a poll' }),
    el('p', { className: 'sub', textContent: state.instance.ttlHours > 0
      ? `Anyone with the link can vote. Polls on this instance are deleted after ${state.instance.ttlHours} hours.`
      : 'Anyone with the link can vote.' }),
  );

  const question = el('input', { type: 'text', placeholder: 'What should we decide?', maxLength: 500 });
  const optionsWrap = el('div');
  const duration = el('select');
  for (const [label, hours] of [['1 hour', 1], ['4 hours', 4], ['12 hours', 12], ['24 hours', 24], ['3 days', 72], ['7 days', 168]]) {
    duration.append(el('option', { value: String(hours), textContent: label, selected: hours === 24 }));
  }
  const multi = el('input', { type: 'checkbox' });

  const addOption = (value = '') => {
    const input = el('input', { type: 'text', placeholder: `Option ${optionsWrap.children.length + 1}`, value, maxLength: 200 });
    const remove = el('button', { className: 'icon', type: 'button', textContent: '✕', title: 'Remove option' });
    const row = el('div', { className: 'option-row' }, [input, remove]);
    remove.addEventListener('click', () => {
      if (optionsWrap.children.length <= 2) return;
      row.remove();
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); addOption(); }
    });
    optionsWrap.append(row);
    input.focus();
  };
  addOption();
  addOption();

  const error = el('div', { className: 'notice error', hidden: true });
  const submit = el('button', { className: 'block', textContent: 'Create poll' });

  submit.addEventListener('click', async () => {
    const options = [...optionsWrap.querySelectorAll('input')].map(input => input.value.trim()).filter(Boolean);
    error.hidden = true;
    if (!question.value.trim()) return showError(error, 'Give the poll a question.');
    if (options.length < 2) return showError(error, 'Add at least two options.');

    submit.disabled = true;
    submit.textContent = 'Creating…';
    try {
      const { poll } = await api('/api/lite/poll', {
        method: 'POST',
        body: JSON.stringify({
          question: question.value.trim(),
          options,
          durationHours: Number(duration.value),
          allowMultipleChoices: multi.checked,
          authorId: state.identity.deviceId,
        }),
      });
      rememberPoll(poll);
      location.hash = `#/p/${poll.id}`;
    } catch (err) {
      showError(error, err.message);
      submit.disabled = false;
      submit.textContent = 'Create poll';
    }
  });

  view.append(el('div', { className: 'card' }, [
    error,
    el('div', { className: 'field' }, [el('label', { textContent: 'Question' }), question]),
    el('div', { className: 'field' }, [
      el('label', { textContent: 'Options' }),
      optionsWrap,
      el('button', { className: 'secondary', type: 'button', textContent: '+ Add option', onclick: () => addOption() }),
    ]),
    el('div', { className: 'field' }, [el('label', { textContent: 'Open for' }), duration]),
    el('label', { className: 'checkbox' }, [multi, 'Allow more than one choice']),
    el('div', { className: 'actions' }, [submit]),
  ]));

  renderHistory();
}

function showError(node, message) {
  node.textContent = message;
  node.hidden = false;
}

function renderHistory() {
  const polls = Object.values(readStore(HISTORY_KEY)).sort((a, b) => b.createdAt - a.createdAt).slice(0, 12);
  if (polls.length === 0) return;
  view.append(el('div', { className: 'card' }, [
    el('h2', { textContent: 'On this device' }),
    el('ul', { className: 'list' }, polls.map(poll => el('li', {}, [
      el('a', { href: `#/p/${poll.id}` }, [
        poll.question,
        el('small', { textContent: poll.expiresAt < Date.now() ? 'closed' : timeLeft(poll.expiresAt) }),
      ]),
    ]))),
  ]));
}

async function renderPoll(pollId, { silent = false } = {}) {
  state.currentPollId = pollId;
  if (!silent) view.replaceChildren(el('p', { className: 'spinner', textContent: 'Loading poll…' }));

  let poll;
  try {
    ({ poll } = await api(`/api/lite/poll/${encodeURIComponent(pollId)}`));
  } catch (err) {
    view.replaceChildren(
      el('div', { className: 'notice error', textContent: err.message }),
      el('a', { href: '#/', textContent: '← Create a poll instead' }),
    );
    return;
  }

  rememberPoll(poll);
  const voted = myVote(pollId);
  const closed = poll.isExpired;
  const showResults = voted || closed || poll.showResultsBeforeVoting;

  const card = el('div', { className: 'card' }, [
    el('h1', { textContent: poll.question }),
    el('p', { className: 'sub', textContent: `${poll.totalVotes} ${poll.totalVotes === 1 ? 'vote' : 'votes'} · ${closed ? 'closed' : timeLeft(poll.expiresAt)}` }),
  ]);

  if (voted) {
    card.append(el('div', { className: 'notice ok' }, [
      'Your vote is in. ',
      el('a', { href: `#/r/${voted.receipt.code}`, textContent: 'View receipt' }),
    ]));
  } else if (closed) {
    card.append(el('div', { className: 'notice', textContent: 'This poll has closed.' }));
  }

  if (voted || closed) {
    card.append(...resultBars(poll, voted));
  } else {
    const error = el('div', { className: 'notice error', hidden: true });
    const inputs = poll.options.map(option => {
      const input = el('input', {
        type: poll.allowMultipleChoices ? 'checkbox' : 'radio',
        name: 'choice',
        value: option.id,
      });
      return el('label', { className: 'choice' }, [input, option.text]);
    });
    const submit = el('button', { className: 'block', textContent: 'Vote' });

    submit.addEventListener('click', async () => {
      const optionIds = inputs
        .map(label => label.querySelector('input'))
        .filter(input => input.checked)
        .map(input => input.value);
      error.hidden = true;
      if (optionIds.length === 0) return showError(error, 'Pick an option first.');

      submit.disabled = true;
      submit.textContent = 'Sending…';
      try {
        const payload = { pollId, optionIds, deviceId: state.identity.deviceId, timestamp: Date.now() };
        const result = await api('/api/lite/vote', {
          method: 'POST',
          body: JSON.stringify({
            ...payload,
            pubkey: state.identity.publicKey,
            signature: await state.identity.sign(payload),
          }),
        });
        rememberVote(pollId, optionIds, result.receipt);
        renderPoll(pollId);
      } catch (err) {
        showError(error, err.message);
        submit.disabled = false;
        submit.textContent = 'Vote';
      }
    });

    card.append(error, ...inputs, el('div', { className: 'actions' }, [submit]));
    if (showResults && poll.totalVotes > 0) {
      card.append(el('h2', { textContent: 'Results so far', style: 'margin-top:24px' }), ...resultBars(poll, voted));
    }
  }

  const shareUrl = `${location.origin}/#/p/${poll.id}`;
  const shareInput = el('input', { type: 'text', value: shareUrl, readOnly: true });
  const copy = el('button', { className: 'secondary', textContent: 'Copy' });
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      shareInput.select();
      document.execCommand?.('copy');
    }
    copy.textContent = 'Copied';
    setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
  });

  const shareCard = el('div', { className: 'card' }, [
    el('h2', { textContent: 'Share this poll' }),
    el('p', { className: 'empty', textContent: 'Anyone who can reach this server can open the link and vote.' }),
    el('div', { className: 'share' }, [shareInput, copy]),
  ]);
  if (navigator.share) {
    const shareBtn = el('button', { className: 'secondary', textContent: 'Share…', style: 'margin-top:10px' });
    shareBtn.addEventListener('click', () => navigator.share({ title: poll.question, url: shareUrl }).catch(() => {}));
    shareCard.append(shareBtn);
  }

  view.replaceChildren(card, shareCard, el('p', { style: 'margin-top:18px' }, [el('a', { href: '#/', textContent: '← New poll' })]));
}

function resultBars(poll, voted) {
  const total = poll.options.reduce((sum, option) => sum + option.votes, 0) || 1;
  return poll.options.map(option => el('div', {
    className: `result${voted?.optionIds?.includes(option.id) ? ' mine' : ''}`,
  }, [
    el('div', { className: 'result-head' }, [
      el('strong', { textContent: option.text }),
      el('span', { className: 'count', textContent: `${option.votes} · ${Math.round((option.votes / total) * 100)}%` }),
    ]),
    el('div', { className: 'bar' }, [el('span', { style: `width:${(option.votes / total) * 100}%` })]),
  ]));
}

async function renderReceipt(code) {
  state.currentPollId = null;
  view.replaceChildren(el('p', { className: 'spinner', textContent: 'Looking up receipt…' }));

  let receipt;
  try {
    ({ receipt } = await api(`/api/lite/receipt/${encodeURIComponent(code)}`));
  } catch (err) {
    view.replaceChildren(
      el('div', { className: 'notice error', textContent: err.message }),
      el('a', { href: '#/', textContent: '← Back' }),
    );
    return;
  }

  const mine = receipt.deviceId === state.identity.deviceId;
  view.replaceChildren(el('div', { className: 'card' }, [
    el('h1', { textContent: 'Vote receipt' }),
    el('p', { className: 'sub', textContent: mine ? 'Signed by this device.' : 'Signed by another device.' }),
    el('div', { className: 'field' }, [el('label', { textContent: 'Verification code' }), el('div', { className: 'code', textContent: receipt.code })]),
    el('div', { className: 'field' }, [el('label', { textContent: 'Content hash' }), el('div', { className: 'hash', textContent: receipt.hash })]),
    el('div', { className: 'field' }, [el('label', { textContent: 'Signature' }), el('div', { className: 'hash', textContent: receipt.signature || '(unsigned — this browser has no WebCrypto)' })]),
    el('div', { className: 'meta' }, [
      el('span', { textContent: new Date(receipt.timestamp).toLocaleString() }),
      el('a', { href: `#/p/${receipt.pollId}`, textContent: 'Open the poll' }),
    ]),
  ]));
}

// ── Router ───────────────────────────────────────────────────────────────────

function route() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const poll = hash.match(/^\/p\/(.+)$/);
  if (poll) return renderPoll(decodeURIComponent(poll[1]));
  const receipt = hash.match(/^\/r\/(.+)$/);
  if (receipt) return renderReceipt(decodeURIComponent(receipt[1]));
  return renderHome();
}

async function start() {
  try {
    state.instance = await api('/api/instance');
  } catch {
    // Relay not answering yet — defaults are fine, the UI still renders.
  }
  document.documentElement.style.setProperty('--accent', state.instance.accentColor || '#4f7cff');
  const name = state.instance.name || 'Polls';
  document.title = name;
  for (const node of document.querySelectorAll('[data-instance-name]')) node.textContent = name;
  document.querySelector('[data-ttl-note]').textContent = state.instance.ephemeral
    ? 'Nothing is written to disk on this instance.'
    : state.instance.ttlHours > 0
      ? `Polls are deleted ${state.instance.ttlHours} h after they are created.`
      : 'Polls are kept until the operator removes them.';

  state.identity = await loadIdentity();
  connect();
  window.addEventListener('hashchange', route);
  route();
}

start();
