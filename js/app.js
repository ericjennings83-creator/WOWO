import * as S from './store.js';
import { esc, money, num, isoDate, shortDate, prettyDate, monthKey, monthLabel, periodRange } from './util.js';

const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');
const sheetRoot = $('#sheet-root');

// UI state that doesn't need to survive a reload.
const ui = {
  period: 'month',
  offset: 0,
  customerSearch: '',
  jobSearch: '',
  expenseTab: 'expenses',
  crewYear: new Date().getFullYear(),
};

// ---------------------------------------------------------------- routing

const IN_CLAUDE = !!(window.claude && typeof window.claude.use === 'function');
if (IN_CLAUDE) document.documentElement.classList.add('in-claude');

// Navigation state lives in the page. On claude.ai the frame can't carry a
// #/path hash, so the hash is only mirrored for the stand-alone web app.
let current = /^#\/(home|customers|customer|jobs|crew|worker|expenses|journal|settings|review)\b/.test(location.hash) ? location.hash : '#/home';

function go(path) {
  current = path;
  if (!IN_CLAUDE) { try { history.replaceState(null, '', path); } catch (e) { /* ignore */ } }
  route();
  window.scrollTo(0, 0);
}

function route() {
  const [name, id] = (current.replace(/^#\/?/, '') || 'home').split('/');
  const tab = { customer: 'customers', worker: 'crew', settings: 'home', review: 'home' }[name] || name;
  document.querySelectorAll('.tabbar a').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
  const renderers = {
    home: renderHome,
    customers: renderCustomers,
    customer: () => renderCustomer(id),
    jobs: renderJobs,
    crew: renderCrew,
    worker: () => renderWorker(id),
    expenses: renderExpenses,
    journal: renderJournal,
    settings: renderSettings,
    review: renderReview,
  };
  (renderers[name] || renderHome)();
}

function rerender() {
  const scroll = window.scrollY;
  route();
  window.scrollTo(0, scroll);
}

window.addEventListener('hashchange', () => {
  if (!IN_CLAUDE && location.hash.startsWith('#/') && location.hash !== current) go(location.hash);
});

document.addEventListener('click', e => {
  const a = e.target.closest('a[href^="#/"]');
  if (!a) return;
  e.preventDefault();
  go(a.getAttribute('href'));
});
S.onChange(rerender);

// ---------------------------------------------------------------- helpers

function header(title, right = '') {
  return `<header class="topbar"><h1>${esc(title)}</h1><div class="topbar-actions">${right}</div></header>${statusBanner()}`;
}

function statusBanner() {
  const st = S.getStatus();
  if (st.state === 'error') return `<div class="banner danger" role="alert">${esc(st.message)}</div>`;
  if (IN_CLAUDE && st.cloudUnavailable) return `<div class="banner warn">Cloud saving isn't available right now, so changes are only kept in this browser. Export a backup from Settings.</div>`;
  return '';
}

function statusLine() {
  const st = S.getStatus();
  if (st.mode === 'cloud') {
    return st.state === 'saving' ? 'Saving to your Claude account…' : st.state === 'error' ? st.message : 'Saved to your Claude account. Open this page on any device where you sign in to Claude to see the same data.';
  }
  if (st.state === 'connecting') return 'Connecting to your Claude account…';
  return 'Your data is stored only in this browser on this device.';
}

// ---------------------------------------------------------------- confirm dialog
// claude.ai pages can't show confirm()/alert(), so confirmations are in-page.

function askConfirm(message, { ok = 'OK', danger = false, cancel = 'Cancel' } = {}) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'dialog-backdrop';
    wrap.innerHTML = `<div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-msg">
      <p id="dialog-msg">${esc(message)}</p>
      <div class="dialog-actions">
        ${cancel ? `<button type="button" class="btn" data-answer="no">${esc(cancel)}</button>` : ''}
        <button type="button" class="btn ${danger ? 'danger-fill' : 'primary'}" data-answer="yes">${esc(ok)}</button>
      </div></div>`;
    const done = answer => { wrap.remove(); document.removeEventListener('keydown', onKey); resolve(answer); };
    const onKey = e => { if (e.key === 'Escape') done(false); };
    wrap.addEventListener('click', e => {
      const b = e.target.closest('[data-answer]');
      if (b) done(b.dataset.answer === 'yes');
      else if (e.target === wrap) done(false);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    wrap.querySelector('[data-answer="yes"]').focus();
  });
}

async function saveFile(filename, text, type) {
  if (IN_CLAUDE) {
    const downloads = await window.claude.use('downloads');
    if (!downloads) { toast('Saving files is not available here.'); return; }
    try { await downloads.save({ filename, data: text }); } catch (e) {
      if (e && e.code !== 'declined') toast('Could not save the file. Try again.');
    }
    return;
  }
  const blob = new Blob([text], { type });
  const file = new File([blob], filename, { type });
  // On iPhone the share sheet lets you save to Files, AirDrop, email, etc.
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file], title: filename }).catch(() => {});
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function addButton(action, label = 'Add') {
  return `<button class="btn-icon" data-action="${action}" aria-label="${esc(label)}">＋</button>`;
}

function empty(msg, action, label) {
  return `<div class="empty"><p>${esc(msg)}</p>${action ? `<button class="btn primary" data-action="${action}">${esc(label)}</button>` : ''}</div>`;
}

function groupByMonth(items, amountFn) {
  const groups = new Map();
  for (const it of items) {
    const k = it.date ? monthKey(it.date) : 'none';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  return [...groups.entries()].map(([k, list]) => ({
    key: k,
    label: k === 'none' ? 'No date' : monthLabel(k, true),
    list,
    total: amountFn ? list.reduce((s, x) => s + amountFn(x), 0) : 0,
  }));
}

function options(list, selected, { blank } = {}) {
  let html = blank != null ? `<option value="">${esc(blank)}</option>` : '';
  for (const o of list) {
    const value = typeof o === 'string' ? o : o.value;
    const label = typeof o === 'string' ? o : o.label;
    html += `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`;
  }
  return html;
}

function field(label, input, hint = '') {
  return `<label class="field"><span>${esc(label)}</span>${input}${hint ? `<small>${hint}</small>` : ''}</label>`;
}

function toggle(name, checked, label, hint = '') {
  return `<label class="toggle-row"><span><b>${esc(label)}</b>${hint ? `<small>${hint}</small>` : ''}</span>
    <input type="checkbox" name="${name}" ${checked ? 'checked' : ''} role="switch"></label>`;
}

// ---------------------------------------------------------------- sheet (modal form)

let sheetHandlers = null;

function openSheet({ title, body, onSave, onDelete, deleteLabel = 'Delete', saveLabel = 'Save', onMount }) {
  sheetRoot.innerHTML = `
    <div class="sheet-backdrop"></div>
    <form class="sheet" novalidate>
      <div class="sheet-head">
        <button type="button" class="link" data-sheet="cancel">Cancel</button>
        <h2>${esc(title)}</h2>
        ${onSave ? `<button type="submit" class="link strong">${esc(saveLabel)}</button>` : '<span></span>'}
      </div>
      <div class="sheet-body">
        ${body}
        ${onDelete ? `<button type="button" class="btn danger block" data-sheet="delete">${esc(deleteLabel)}</button>` : ''}
      </div>
    </form>`;
  document.body.classList.add('sheet-open');
  sheetHandlers = { onSave, onDelete };
  const form = $('.sheet', sheetRoot);
  requestAnimationFrame(() => sheetRoot.classList.add('show'));
  if (onMount) onMount(form);
  return form;
}

function closeSheet() {
  sheetRoot.classList.remove('show');
  document.body.classList.remove('sheet-open');
  sheetHandlers = null;
  setTimeout(() => { if (!sheetHandlers) sheetRoot.innerHTML = ''; }, 250);
}

sheetRoot.addEventListener('submit', e => {
  e.preventDefault();
  const form = e.target;
  const bad = [...form.querySelectorAll('[required]')].find(el => !el.value.trim());
  if (bad) { bad.focus(); bad.classList.add('invalid'); return; }
  const values = Object.fromEntries(new FormData(form).entries());
  form.querySelectorAll('input[type=checkbox][name]').forEach(cb => { if (!cb.closest('.chips, .crew-list')) values[cb.name] = cb.checked; });
  if (sheetHandlers && sheetHandlers.onSave(values, form) !== false) closeSheet();
});

sheetRoot.addEventListener('click', e => {
  if (e.target.classList.contains('sheet-backdrop')) return closeSheet();
  const btn = e.target.closest('[data-sheet]');
  if (!btn) return;
  if (btn.dataset.sheet === 'cancel') closeSheet();
  if (btn.dataset.sheet === 'delete' && sheetHandlers.onDelete) {
    const onDelete = sheetHandlers.onDelete;
    askConfirm('Delete this? This cannot be undone.', { ok: 'Delete', danger: true }).then(yes => {
      if (!yes) return;
      onDelete();
      closeSheet();
    });
  }
});

// ---------------------------------------------------------------- HOME / REPORTS

function renderHome() {
  const d = S.get();
  const range = periodRange(ui.period, ui.offset);
  const r = S.summarize(range);
  const periods = [['week', 'Week'], ['month', 'Month'], ['quarter', 'Qtr'], ['year', 'Year'], ['all', 'All']];

  view.innerHTML = `
    ${header(d.settings.businessName || 'Detailing', `<a class="btn-icon" href="#/settings" aria-label="Settings">⚙︎</a>`)}
    <div class="quick-add">
      <button class="btn primary" data-action="new-job">＋ Job</button>
      <button class="btn" data-action="new-expense">＋ Expense</button>
      <button class="btn" data-action="new-trip">＋ Miles</button>
    </div>

    ${reviewCallout()}
    <div class="segmented" role="tablist">
      ${periods.map(([k, l]) => `<button data-action="period" data-period="${k}" class="${ui.period === k ? 'on' : ''}">${l}</button>`).join('')}
    </div>
    <div class="period-nav">
      ${ui.period !== 'all' ? `<button class="btn-icon" data-action="period-prev" aria-label="Previous">‹</button>` : '<span></span>'}
      <strong>${esc(range.label)}</strong>
      ${ui.period !== 'all' ? `<button class="btn-icon" data-action="period-next" aria-label="Next" ${ui.offset >= 0 ? 'disabled' : ''}>›</button>` : '<span></span>'}
    </div>

    <section class="hero card">
      <span class="label">Net profit</span>
      <span class="hero-num ${r.profit < 0 ? 'neg' : ''}">${money(r.profit)}</span>
      <span class="sub">${money(r.income)} income − ${money(r.expenseTotal)} expenses${r.laborPaid ? ` − ${money(r.laborPaid)} crew pay` : ''}</span>
    </section>

    <section class="tiles">
      ${tile('Income', money(r.income), `${r.jobs.length} job${r.jobs.length === 1 ? '' : 's'}${r.tips ? ` · ${money(r.tips, false)} tips` : ''}`)}
      ${tile('Expenses', money(r.expenseTotal), `${r.expenses.length} entr${r.expenses.length === 1 ? 'y' : 'ies'}`)}
      ${tile('Miles', num(r.miles), `${money(r.mileageDeduction)} deduction`)}
      ${tile('Owner contributions', money(r.contributed), `${r.contributions.length} entr${r.contributions.length === 1 ? 'y' : 'ies'}`)}
      ${tile('Avg per job', money(r.jobs.length ? r.revenue / r.jobs.length : 0), 'before tips')}
      ${tile('Unpaid', money(r.unpaid), r.unpaid ? 'still owed to you' : 'all caught up', r.unpaid ? 'warn' : '')}
      ${d.workers.length ? tile('Crew pay', money(r.laborPaid), `${money(r.laborEarned)} commission earned`) : ''}
      ${d.workers.length ? tile('Owed to crew', money(r.owedToCrew), r.owedToCrew > 0.004 ? 'all time, not paid yet' : 'all paid up', r.owedToCrew > 0.004 ? 'warn' : '') : ''}
    </section>

    <section class="card">
      <h3>Income by month <small>last 12 months</small></h3>
      ${monthlyChart()}
    </section>

    <section class="card">
      <h3>Top services <small>${esc(range.label)}</small></h3>
      ${barList(r.byService.map(s => ({ name: s.name, value: s.revenue, note: `${s.count}×` })), 'No jobs in this period.')}
    </section>

    <section class="card">
      <h3>Expenses by category <small>${esc(range.label)}</small></h3>
      ${barList(r.byCategory.map(c => ({ name: c.name, value: c.total })), 'No expenses in this period.')}
    </section>

    <section class="card">
      <h3>Top customers <small>${esc(range.label)}</small></h3>
      ${barList(r.byCustomer.slice(0, 8).map(c => ({ name: c.name, value: c.total })), 'No jobs in this period.')}
    </section>

    <section class="card tax">
      <h3>Tax estimate <small>${esc(range.label)}</small></h3>
      <dl>
        <dt>Income (incl. tips)</dt><dd>${money(r.income)}</dd>
        <dt>Expenses</dt><dd>− ${money(r.expenseTotal)}</dd>
        ${r.laborPaid ? `<dt>Contract labor (crew)</dt><dd>− ${money(r.laborPaid)}</dd>` : ''}
        <dt>Mileage (${num(r.miles)} mi × ${money(d.settings.mileageRate)})</dt><dd>− ${money(r.mileageDeduction)}</dd>
        <dt class="total">Estimated net</dt><dd class="total">${money(r.taxableEstimate)}</dd>
      </dl>
      <p class="fine">A rough estimate only. If you take the standard mileage rate you generally can't also deduct actual fuel or repair costs for the same vehicle. Check with your tax preparer.</p>
    </section>
  `;
}

function reviewCallout() {
  const pending = S.reviewItems().filter(r => r.status === 'pending').length;
  if (!pending) return '';
  return `<a class="card review-callout" href="#/review">
    <span><b>Review your notes</b><small>${pending} ${pending === 1 ? 'entry' : 'entries'} from your notebook waiting to be checked and added</small></span>
    <span class="chev">›</span></a>`;
}

function tile(label, value, sub, tone = '') {
  return `<div class="tile card ${tone}"><span class="label">${esc(label)}</span><span class="value">${value}</span><span class="sub">${esc(sub)}</span></div>`;
}

function barList(items, emptyMsg) {
  if (!items.length) return `<p class="muted">${esc(emptyMsg)}</p>`;
  const max = Math.max(...items.map(i => i.value), 1);
  return `<ul class="barlist">${items.map(i => `
    <li>
      <div class="barlist-row"><span>${esc(i.name)}${i.note ? ` <small>${esc(i.note)}</small>` : ''}</span><b>${money(i.value)}</b></div>
      <div class="barlist-track"><div class="barlist-fill" style="width:${Math.max(2, (i.value / max) * 100)}%"></div></div>
    </li>`).join('')}</ul>`;
}

function monthlyChart() {
  const d = S.get();
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const k = isoDate(new Date(now.getFullYear(), now.getMonth() - i, 1)).slice(0, 7);
    months.push({ key: k, total: 0 });
  }
  const idx = Object.fromEntries(months.map((m, i) => [m.key, i]));
  for (const j of d.jobs) {
    const i = idx[monthKey(j.date || '')];
    if (i != null) months[i].total += S.jobTotal(j);
  }
  const max = Math.max(...months.map(m => m.total));
  if (!max) return `<p class="muted">Log a job to see your monthly income here.</p>`;
  const last = months[months.length - 1];
  return `
    <div class="chart" role="img" aria-label="Income by month">
      <div class="chart-tip" hidden></div>
      <div class="chart-bars">
        ${months.map(m => `
          <button class="chart-col" data-action="chart-tip" data-tip="${esc(monthLabel(m.key, true))}: ${esc(money(m.total))}" aria-label="${esc(monthLabel(m.key, true))} ${esc(money(m.total))}">
            <span class="chart-bar" style="height:${m.total ? Math.max(2, (m.total / max) * 100) : 0}%"></span>
          </button>`).join('')}
      </div>
      <div class="chart-axis">${months.map(m => `<span>${esc(monthLabel(m.key).slice(0, 1))}</span>`).join('')}</div>
    </div>
    <p class="chart-caption">This month so far: <b>${money(last.total)}</b> · Best month: <b>${money(max)}</b> · Tap a bar for details.</p>
    <details class="table-view"><summary>Show as table</summary>
      <table>${months.slice().reverse().map(m => `<tr><td>${esc(monthLabel(m.key, true))}</td><td>${money(m.total)}</td></tr>`).join('')}</table>
    </details>`;
}

// ---------------------------------------------------------------- CUSTOMERS

function renderCustomers() {
  const d = S.get();
  view.innerHTML = `
    ${header('Clients', addButton('new-customer', 'New client'))}
    <input class="search" type="search" placeholder="Search name, phone, car, plate…" value="${esc(ui.customerSearch)}" data-search="customer">
    ${!d.customers.length ? empty('No customers yet.', 'new-customer', 'Add your first customer') : ''}
    <div id="results">${customerResults()}</div>`;
}

function customerResults() {
  const d = S.get();
  const q = ui.customerSearch.trim().toLowerCase();
  const spend = {};
  const lastVisit = {};
  for (const j of d.jobs) {
    spend[j.customerId] = (spend[j.customerId] || 0) + S.jobTotal(j);
    if (!lastVisit[j.customerId] || j.date > lastVisit[j.customerId]) lastVisit[j.customerId] = j.date;
  }
  const list = d.customers
    .filter(c => !q || [c.name, c.phone, c.email, c.address, ...c.vehicles.map(S.describeVehicle), ...c.vehicles.map(v => v.plate)]
      .some(v => (v || '').toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!list.length) return d.customers.length ? `<p class="muted center">No matches.</p>` : '';
  return `
    <ul class="list">
      ${list.map(c => `
        <li><a href="#/customer/${c.id}" class="row">
          <div class="row-main">
            <b>${esc(c.name)}</b>
            <small>${esc(c.vehicles.map(S.describeVehicle).join(', ') || c.phone || 'No vehicles yet')}</small>
          </div>
          <div class="row-end">
            <b>${money(spend[c.id] || 0, false)}</b>
            <small>${lastVisit[c.id] ? 'Last ' + esc(shortDate(lastVisit[c.id])) : 'No jobs'}</small>
          </div>
        </a></li>`).join('')}
    </ul>`;
}

function renderCustomer(id) {
  const c = S.find('customers', id);
  if (!c) { go('#/customers'); return; }
  const jobs = S.get().jobs.filter(j => j.customerId === id).sort(S.byDateDesc);
  const lifetime = jobs.reduce((s, j) => s + S.jobTotal(j), 0);
  const phone = (c.phone || '').replace(/[^\d+]/g, '');

  view.innerHTML = `
    <header class="topbar"><a class="back" href="#/customers">‹ Clients</a>
      <div class="topbar-actions"><button class="link" data-action="edit-customer" data-id="${c.id}">Edit</button></div></header>
    <section class="profile">
      <h1>${esc(c.name)}</h1>
      <div class="contact-actions">
        ${phone ? `<a class="btn" href="tel:${esc(phone)}">Call</a><a class="btn" href="sms:${esc(phone)}">Text</a>` : ''}
        ${c.email ? `<a class="btn" href="mailto:${esc(c.email)}">Email</a>` : ''}
        ${c.address ? `<a class="btn" href="https://maps.apple.com/?q=${encodeURIComponent(c.address)}" target="_blank" rel="noopener">Directions</a>` : ''}
      </div>
    </section>
    <section class="card info">
      ${c.phone ? `<div><span>Phone</span><b>${esc(c.phone)}</b></div>` : ''}
      ${c.email ? `<div><span>Email</span><b>${esc(c.email)}</b></div>` : ''}
      ${c.address ? `<div><span>Address</span><b>${esc(c.address)}</b></div>` : ''}
      <div><span>Lifetime spend</span><b>${money(lifetime)}</b></div>
      <div><span>Jobs</span><b>${jobs.length}</b></div>
      ${c.notes ? `<div class="notes"><span>Notes</span><p>${esc(c.notes)}</p></div>` : ''}
    </section>

    <div class="section-head"><h2>Vehicles</h2><button class="link" data-action="new-vehicle" data-id="${c.id}">＋ Add</button></div>
    ${c.vehicles.length ? `<ul class="list">${c.vehicles.map(v => `
      <li><button class="row" data-action="edit-vehicle" data-id="${c.id}" data-vid="${v.id}">
        <div class="row-main"><b>${esc(S.describeVehicle(v))}</b><small>${esc([v.plate && 'Plate ' + v.plate, v.notes].filter(Boolean).join(' · ') || ' ')}</small></div>
        <span class="chev">›</span>
      </button></li>`).join('')}</ul>` : `<p class="muted">No vehicles yet.</p>`}

    <div class="section-head"><h2>Job history</h2><button class="link" data-action="new-job" data-customer="${c.id}">＋ New job</button></div>
    ${jobs.length ? `<ul class="list">${jobs.map(jobRow).join('')}</ul>` : `<p class="muted">No jobs yet.</p>`}
  `;
}

function customerForm(c = {}) {
  const isNew = !c.id;
  openSheet({
    title: isNew ? 'New customer' : 'Edit customer',
    body: `
      ${field('Name', `<input name="name" required value="${esc(c.name)}" autocomplete="off">`)}
      ${field('Phone', `<input name="phone" type="tel" value="${esc(c.phone)}">`)}
      ${field('Email', `<input name="email" type="email" value="${esc(c.email)}">`)}
      ${field('Address', `<textarea name="address" rows="2">${esc(c.address)}</textarea>`)}
      ${field('Notes', `<textarea name="notes" rows="3" placeholder="Gate code, pets, preferences…">${esc(c.notes)}</textarea>`)}
      ${isNew ? `<fieldset class="group"><legend>First vehicle (optional)</legend>${vehicleFields({})}</fieldset>` : ''}
    `,
    onSave: v => {
      const item = { ...c, name: v.name.trim(), phone: v.phone.trim(), email: v.email.trim(), address: v.address.trim(), notes: v.notes.trim() };
      if (isNew) {
        item.createdAt = isoDate();
        item.vehicles = [];
        const veh = vehicleFromValues(v);
        if (veh) item.vehicles.push(veh);
      }
      const saved = S.upsert('customers', item);
      if (isNew) go('#/customer/' + saved.id);
    },
    onDelete: isNew ? null : () => { S.deleteCustomer(c.id); go('#/customers'); },
    deleteLabel: 'Delete customer',
  });
}

function vehicleFields(v) {
  return `
    <div class="grid2">
      ${field('Year', `<input name="year" inputmode="numeric" maxlength="4" value="${esc(v.year)}">`)}
      ${field('Color', `<input name="color" value="${esc(v.color)}">`)}
    </div>
    <div class="grid2">
      ${field('Make', `<input name="make" value="${esc(v.make)}" placeholder="Toyota">`)}
      ${field('Model', `<input name="model" value="${esc(v.model)}" placeholder="Tacoma">`)}
    </div>
    ${field('License plate', `<input name="plate" value="${esc(v.plate)}" autocapitalize="characters">`)}
    ${field('Vehicle notes', `<input name="vnotes" value="${esc(v.notes)}" placeholder="Size, condition, coatings…">`)}`;
}

function vehicleFromValues(v, existing = {}) {
  const veh = {
    ...existing,
    id: existing.id || S.uid(),
    year: (v.year || '').trim(), make: (v.make || '').trim(), model: (v.model || '').trim(),
    color: (v.color || '').trim(), plate: (v.plate || '').trim().toUpperCase(), notes: (v.vnotes || '').trim(),
  };
  return (veh.year || veh.make || veh.model || veh.color || veh.plate) ? veh : null;
}

function vehicleForm(customerId, vehicleId) {
  const c = S.find('customers', customerId);
  const v = c.vehicles.find(x => x.id === vehicleId) || {};
  openSheet({
    title: v.id ? 'Edit vehicle' : 'Add vehicle',
    body: vehicleFields(v),
    onSave: vals => {
      const veh = vehicleFromValues(vals, v);
      if (!veh) { toast('Enter at least a make, model, or plate.'); return false; }
      const vehicles = v.id ? c.vehicles.map(x => x.id === v.id ? veh : x) : [...c.vehicles, veh];
      S.upsert('customers', { ...c, vehicles });
    },
    onDelete: v.id ? () => S.upsert('customers', { ...c, vehicles: c.vehicles.filter(x => x.id !== v.id) }) : null,
    deleteLabel: 'Remove vehicle',
  });
}

// ---------------------------------------------------------------- JOBS

function jobRow(j) {
  const who = S.customerName(j.customerId) || 'No customer';
  const car = S.vehicleLabel(j.customerId, j.vehicleId);
  const crew = (j.crew || []).map(m => S.workerName(m.workerId)).filter(Boolean);
  return `<li><button class="row" data-action="edit-job" data-id="${j.id}">
    <div class="row-main">
      <b>${esc(who)}${car ? ` <small>· ${esc(car)}</small>` : ''}</b>
      <small>${esc(shortDate(j.date))} · ${esc((j.services || []).join(', ') || 'No services listed')}</small>
      ${crew.length ? `<small>Crew: ${esc(crew.join(', '))} · ${money(S.jobCommission(j))}</small>` : ''}
    </div>
    <div class="row-end">
      <b>${money(S.jobTotal(j))}</b>
      ${j.paid ? `<small>${esc(j.paymentMethod || 'Paid')}</small>` : `<span class="badge warn">Unpaid</span>`}
    </div>
  </button></li>`;
}

function renderJobs() {
  const d = S.get();
  const unpaid = d.jobs.filter(j => !j.paid);
  view.innerHTML = `
    ${header('Jobs', addButton('new-job', 'New job'))}
    <input class="search" type="search" placeholder="Search customer, car, service…" value="${esc(ui.jobSearch)}" data-search="job">
    ${unpaid.length ? `<div class="banner warn">${unpaid.length} unpaid job${unpaid.length === 1 ? '' : 's'} · ${money(unpaid.reduce((s, j) => s + S.jobTotal(j), 0))} owed</div>` : ''}
    ${!d.jobs.length ? empty('No jobs logged yet.', 'new-job', 'Log your first job') : ''}
    <div id="results">${jobResults()}</div>`;
}

function jobResults() {
  const d = S.get();
  const q = ui.jobSearch.trim().toLowerCase();
  const jobs = [...d.jobs].sort(S.byDateDesc).filter(j => !q || [
    S.customerName(j.customerId), S.vehicleLabel(j.customerId, j.vehicleId), ...(j.services || []), j.notes, j.paymentMethod,
  ].some(v => (v || '').toLowerCase().includes(q)));
  if (!jobs.length) return d.jobs.length ? `<p class="muted center">No matches.</p>` : '';
  return groupByMonth(jobs, S.jobTotal).map(g => `
    <div class="section-head"><h2>${esc(g.label)}</h2><span>${money(g.total)}</span></div>
    <ul class="list">${g.list.map(jobRow).join('')}</ul>`).join('');
}

function jobForm(j = {}, presetCustomer = '', opts = {}) {
  const d = S.get();
  const isNew = !j.id;
  const job = { date: isoDate(), services: [], crew: [], paid: true, paymentMethod: 'Cash', customerId: presetCustomer, ...j };
  const onJob = Object.fromEntries((job.crew || []).map(m => [m.workerId, m.pct]));
  const crewChoices = [...d.workers].filter(w => w.active !== false || w.id in onJob).sort((a, b) => a.name.localeCompare(b.name));
  const customers = [...d.customers].sort((a, b) => a.name.localeCompare(b.name)).map(c => ({ value: c.id, label: c.name }));
  const serviceNames = new Set(d.settings.services.map(s => s.name));
  const extra = (job.services || []).filter(s => !serviceNames.has(s)).map(name => ({ name, price: 0 }));
  const allServices = [...d.settings.services, ...extra];
  let amountTouched = !isNew;

  const form = openSheet({
    title: isNew ? 'New job' : 'Edit job',
    body: `
      ${field('Date', `<input name="date" type="date" required value="${esc(job.date)}">`)}
      ${field('Customer', `<select name="customerId">${options(customers, job.customerId, { blank: customers.length ? 'Choose customer…' : 'No customers yet' })}</select>`,
        customers.length ? '' : `<a href="#/customers" data-sheet="cancel">Add customers on the Clients tab first</a>`)}
      ${field('Vehicle', `<select name="vehicleId"></select>`)}
      <fieldset class="group"><legend>Services</legend>
        <div class="chips">
          ${allServices.map(s => `<label class="chip"><input type="checkbox" name="svc" value="${esc(s.name)}" data-price="${Number(s.price) || 0}" ${job.services.includes(s.name) ? 'checked' : ''}><span>${esc(s.name)}${s.price ? ` <small>${money(s.price, false)}</small>` : ''}</span></label>`).join('')}
        </div>
        ${field('Other service', `<input name="otherService" placeholder="Anything not listed above">`)}
      </fieldset>
      <div class="grid2">
        ${field('Price', `<input name="amount" type="number" inputmode="decimal" step="0.01" min="0" value="${esc(job.amount)}" placeholder="0.00">`)}
        ${field('Tip', `<input name="tip" type="number" inputmode="decimal" step="0.01" min="0" value="${esc(job.tip)}" placeholder="0.00">`)}
      </div>
      ${crewChoices.length ? `<fieldset class="group"><legend>Crew on this job</legend>
        <div class="crew-list">
          ${crewChoices.map(w => `<div class="crew-row">
            <label class="chip"><input type="checkbox" name="crewMember" value="${w.id}" ${w.id in onJob ? 'checked' : ''}><span>${esc(w.name)}</span></label>
            <input class="pct" type="number" inputmode="decimal" step="0.5" min="0" max="100" name="pct-${w.id}" value="${esc(onJob[w.id] ?? w.commissionPct)}" aria-label="${esc(w.name)} commission percent"><span class="pct-sign">%</span>
            <b class="crew-pay" data-crew-pay="${w.id}"></b>
          </div>`).join('')}
        </div>
        <small class="muted">Commission is on the price, not tips.</small>
      </fieldset>` : ''}
      ${toggle('paid', job.paid, 'Customer paid')}
      ${field('Payment method', `<select name="paymentMethod">${options(S.PAYMENT_METHODS, job.paymentMethod)}</select>`)}
      ${field('Notes', `<textarea name="notes" rows="3">${esc(job.notes)}</textarea>`)}
    `,
    onSave: (v, f) => {
      const services = [...f.querySelectorAll('input[name=svc]:checked')].map(i => i.value);
      if (v.otherService.trim()) services.push(v.otherService.trim());
      const crew = [...f.querySelectorAll('input[name=crewMember]:checked')]
        .map(i => ({ workerId: i.value, pct: parseFloat(v['pct-' + i.value]) || 0 }));
      const saved = S.upsert('jobs', {
        ...j, date: v.date, customerId: v.customerId, vehicleId: v.vehicleId, services, crew,
        amount: parseFloat(v.amount) || 0, tip: parseFloat(v.tip) || 0,
        paid: v.paid, paymentMethod: v.paymentMethod, notes: v.notes.trim(),
      });
      if (opts.onSaved) opts.onSaved(saved);
    },
    onDelete: isNew ? null : () => S.remove('jobs', j.id),
    deleteLabel: 'Delete job',
  });

  const custSel = form.elements.customerId;
  const vehSel = form.elements.vehicleId;
  const fillVehicles = () => {
    const c = S.find('customers', custSel.value);
    const vs = c ? c.vehicles : [];
    vehSel.innerHTML = options(vs.map(v => ({ value: v.id, label: S.describeVehicle(v) })), job.vehicleId || (vs[0] && vs[0].id), { blank: vs.length ? 'Choose vehicle…' : 'No vehicles on file' });
  };
  fillVehicles();
  custSel.addEventListener('change', () => { job.vehicleId = ''; fillVehicles(); });

  // Picking services fills in the price until you type your own.
  form.elements.amount.addEventListener('input', () => { amountTouched = true; });
  form.querySelector('.chips').addEventListener('change', () => {
    if (amountTouched) return;
    const sum = [...form.querySelectorAll('input[name=svc]:checked')].reduce((s, i) => s + Number(i.dataset.price), 0);
    form.elements.amount.value = sum ? sum.toFixed(2) : '';
    showCrewPay();
  });

  // Live commission for each checked crew member.
  const showCrewPay = () => {
    const price = parseFloat(form.elements.amount.value) || 0;
    form.querySelectorAll('[data-crew-pay]').forEach(el => {
      const id = el.dataset.crewPay;
      const on = form.querySelector(`input[name=crewMember][value="${id}"]`).checked;
      const pct = parseFloat(form.elements['pct-' + id].value) || 0;
      el.textContent = on ? money(S.crewPay({ amount: price }, { pct })) : '';
    });
  };
  form.addEventListener('input', showCrewPay);
  form.addEventListener('change', showCrewPay);
  showCrewPay();
}

// ---------------------------------------------------------------- CREW (1099 commission payroll)

function renderCrew() {
  const d = S.get();
  const year = ui.crewYear;
  const yr = { start: `${year}-01-01`, end: `${year}-12-31` };
  const threshold = Number(d.settings.reportThreshold1099) || 0;
  const workers = [...d.workers].sort((a, b) => (a.active === false) - (b.active === false) || a.name.localeCompare(b.name));
  const rows = workers.map(w => ({ w, all: S.workerEarnings(w.id), yr: S.workerEarnings(w.id, yr) }));
  const owed = rows.reduce((s, r) => s + Math.max(0, r.all.owed), 0);
  const recent = [...d.payouts].sort(S.byDateDesc).slice(0, 10);

  view.innerHTML = `
    ${header('Crew', addButton('new-worker', 'New worker'))}
    ${!d.workers.length ? empty('No crew members yet. Add the people you pay a commission to.', 'new-worker', 'Add a crew member') : `
    <section class="hero card">
      <span class="label">Owed to crew</span>
      <span class="hero-num">${money(owed)}</span>
      <span class="sub">Commission earned on jobs minus payments recorded</span>
    </section>
    <button class="btn primary block" data-action="new-payout">＋ Record a payment</button>

    <div class="section-head"><h2>Crew members</h2></div>
    <ul class="list">${rows.map(({ w, all, yr: y }) => `
      <li><a class="row" href="#/worker/${w.id}">
        <div class="row-main">
          <b>${esc(w.name)}${w.active === false ? ' <small>· inactive</small>' : ''}</b>
          <small>${num(w.commissionPct, 2)}% · ${money(y.earned)} in ${year}${w.w9OnFile ? '' : ' · <span class="tag warn">No W-9</span>'}</small>
        </div>
        <div class="row-end">
          <b>${money(Math.max(0, all.owed))}</b>
          <small>${all.owed > 0.004 ? 'owed' : 'paid up'}</small>
        </div>
      </a></li>`).join('')}</ul>

    <section class="card">
      <h3>1099-NEC summary
        <span class="year-nav">
          <button class="btn-icon sm" data-action="crew-year" data-step="-1" aria-label="Previous year">‹</button>
          <b>${year}</b>
          <button class="btn-icon sm" data-action="crew-year" data-step="1" aria-label="Next year" ${year >= new Date().getFullYear() ? 'disabled' : ''}>›</button>
        </span>
      </h3>
      <table class="mini-table">
        <tr><th>Crew member</th><th>Paid in ${year}</th><th></th></tr>
        ${rows.map(({ w, yr: y }) => `<tr><td>${esc(w.name)}</td><td>${money(y.paid)}</td>
          <td>${y.paid >= threshold && threshold > 0 ? '<span class="badge warn">1099 needed</span>' : ''}</td></tr>`).join('')}
      </table>
      <p class="fine">Flags anyone you paid ${money(threshold, false)} or more in the year. The threshold is set in Settings. Confirm the current rules with your tax preparer.</p>
    </section>

    ${recent.length ? `<div class="section-head"><h2>Recent payments</h2></div>
    <ul class="list">${recent.map(payoutRow).join('')}</ul>` : ''}
    `}`;
}

function payoutRow(p) {
  return `<li><button class="row" data-action="edit-payout" data-id="${p.id}">
    <div class="row-main"><b>${esc(S.workerName(p.workerId) || 'Unknown')}</b>
      <small>${esc(shortDate(p.date))}${p.method ? ' · ' + esc(p.method) : ''}${p.notes ? ' · ' + esc(p.notes) : ''}</small></div>
    <div class="row-end"><b>${money(p.amount)}</b></div>
  </button></li>`;
}

function renderWorker(id) {
  const w = S.find('workers', id);
  if (!w) { go('#/crew'); return; }
  const e = S.workerEarnings(id);
  const phone = (w.phone || '').replace(/[^\d+]/g, '');
  view.innerHTML = `
    <header class="topbar"><a class="back" href="#/crew">‹ Crew</a>
      <div class="topbar-actions"><button class="link" data-action="edit-worker" data-id="${w.id}">Edit</button></div></header>
    <section class="profile">
      <h1>${esc(w.name)}</h1>
      <div class="contact-actions">
        ${phone ? `<a class="btn" href="tel:${esc(phone)}">Call</a><a class="btn" href="sms:${esc(phone)}">Text</a>` : ''}
        ${w.email ? `<a class="btn" href="mailto:${esc(w.email)}">Email</a>` : ''}
      </div>
    </section>
    <section class="tiles">
      ${tile('Earned', money(e.earned), `${e.jobs.length} job${e.jobs.length === 1 ? '' : 's'}`)}
      ${tile('Paid', money(e.paid), `${e.payouts.length} payment${e.payouts.length === 1 ? '' : 's'}`)}
      ${tile('Owed', money(Math.max(0, e.owed)), e.owed > 0.004 ? 'not paid yet' : 'paid up', e.owed > 0.004 ? 'warn' : '')}
      ${tile('Commission', num(w.commissionPct, 2) + '%', 'default rate')}
    </section>
    ${e.owed > 0.004 ? `<button class="btn primary block" data-action="new-payout" data-worker="${w.id}" data-amount="${e.owed.toFixed(2)}">Pay ${money(e.owed)}</button>` : ''}
    <section class="card info" style="margin-top:12px">
      <div><span>1099 contractor</span><b>${w.w9OnFile ? 'W-9 on file' : 'No W-9 yet'}</b></div>
      ${w.phone ? `<div><span>Phone</span><b>${esc(w.phone)}</b></div>` : ''}
      ${w.email ? `<div><span>Email</span><b>${esc(w.email)}</b></div>` : ''}
      ${w.notes ? `<div class="notes"><span>Notes</span><p>${esc(w.notes)}</p></div>` : ''}
    </section>

    <div class="section-head"><h2>Payments</h2><button class="link" data-action="new-payout" data-worker="${w.id}">＋ Add</button></div>
    ${e.payouts.length ? `<ul class="list">${e.payouts.map(payoutRow).join('')}</ul>` : `<p class="muted">No payments yet.</p>`}

    <div class="section-head"><h2>Jobs worked</h2></div>
    ${e.jobs.length ? `<ul class="list">${e.jobs.map(({ job, pay }) => `
      <li><button class="row" data-action="edit-job" data-id="${job.id}">
        <div class="row-main"><b>${esc(S.customerName(job.customerId) || 'No customer')}</b>
          <small>${esc(shortDate(job.date))} · ${money(job.amount)} × ${num(job.crew.find(m => m.workerId === w.id).pct, 2)}%</small></div>
        <div class="row-end"><b>${money(pay)}</b></div>
      </button></li>`).join('')}</ul>` : `<p class="muted">Not on any jobs yet. Add crew when you log a job.</p>`}
  `;
}

function workerForm(w = {}) {
  const isNew = !w.id;
  const hasHistory = !isNew && S.workerHasHistory(w.id);
  openSheet({
    title: isNew ? 'New crew member' : 'Edit crew member',
    body: `
      ${field('Name', `<input name="name" required value="${esc(w.name)}" autocomplete="off">`)}
      ${field('Default commission %', `<input name="commissionPct" type="number" inputmode="decimal" step="0.5" min="0" max="100" required value="${esc(w.commissionPct ?? 20)}">`,
        'Percent of the job price (before tips). You can change it per job.')}
      ${field('Phone', `<input name="phone" type="tel" value="${esc(w.phone)}">`)}
      ${field('Email', `<input name="email" type="email" value="${esc(w.email)}">`)}
      ${toggle('w9OnFile', w.w9OnFile, 'W-9 on file', 'You need their W-9 to file a 1099-NEC.')}
      ${toggle('active', w.active !== false, 'Active', 'Inactive crew are hidden when you log new jobs.')}
      ${field('Notes', `<textarea name="notes" rows="3">${esc(w.notes)}</textarea>`)}
      ${hasHistory ? `<p class="fine">This person has jobs or payments on record, so they can't be deleted. Turn off Active instead.</p>` : ''}
    `,
    onSave: v => {
      const saved = S.upsert('workers', {
        ...w, name: v.name.trim(), commissionPct: parseFloat(v.commissionPct) || 0, phone: v.phone.trim(),
        email: v.email.trim(), w9OnFile: v.w9OnFile, active: v.active, notes: v.notes.trim(),
      });
      if (isNew) go('#/worker/' + saved.id);
    },
    onDelete: isNew || hasHistory ? null : () => { S.remove('workers', w.id); go('#/crew'); },
    deleteLabel: 'Delete crew member',
  });
}

function payoutForm(p = {}, preset = {}, opts = {}) {
  const d = S.get();
  const isNew = !p.id;
  const pay = { date: isoDate(), method: 'Cash', workerId: preset.worker || '', amount: preset.amount || '', ...p };
  const workers = [...d.workers].filter(w => w.active !== false || w.id === pay.workerId)
    .sort((a, b) => a.name.localeCompare(b.name)).map(w => ({ value: w.id, label: w.name }));
  const form = openSheet({
    title: isNew ? 'Crew payment' : 'Edit payment',
    body: `
      ${field('Crew member', `<select name="workerId" required>${options(workers, pay.workerId, { blank: 'Choose…' })}</select>`, '<span data-owed></span>')}
      ${field('Date', `<input name="date" type="date" required value="${esc(pay.date)}">`)}
      ${field('Amount', `<input name="amount" type="number" inputmode="decimal" step="0.01" min="0" required value="${esc(pay.amount)}" placeholder="0.00">`)}
      ${field('Paid by', `<select name="method">${options(S.PAYMENT_METHODS, pay.method)}</select>`)}
      ${field('Notes', `<input name="notes" value="${esc(pay.notes)}" placeholder="Week of…, check #…">`)}
    `,
    onSave: v => {
      const saved = S.upsert('payouts', {
        ...p, workerId: v.workerId, date: v.date, amount: parseFloat(v.amount) || 0, method: v.method, notes: v.notes.trim(),
      });
      if (opts.onSaved) opts.onSaved(saved);
    },
    onDelete: isNew ? null : () => S.remove('payouts', p.id),
    deleteLabel: 'Delete payment',
  });
  const showOwed = () => {
    const id = form.elements.workerId.value;
    const owed = id ? S.workerEarnings(id).owed + (isNew ? 0 : Number(p.amount) || 0) : 0;
    form.querySelector('[data-owed]').textContent = id ? `Currently owed: ${money(Math.max(0, owed))}` : '';
    if (isNew && id && !preset.amount && !form.elements.amount.value && owed > 0) form.elements.amount.value = owed.toFixed(2);
  };
  form.elements.workerId.addEventListener('change', () => { form.elements.amount.value = ''; preset.amount = ''; showOwed(); });
  showOwed();
}

// ---------------------------------------------------------------- REVIEW (entries transcribed from notes)

const REVIEW_KINDS = [
  ['all', 'All'], ['flagged', 'Needs a look'], ['trip', 'Mileage'], ['expense', 'Expenses'],
  ['payout', 'Crew pay'], ['job', 'Income'], ['contribution', 'Owner money'],
];
const KIND_LABEL = { trip: 'Mileage', expense: 'Expense', payout: 'Crew payment', job: 'Income', contribution: 'Owner contribution' };

function reviewList() {
  const f = ui.reviewFilter || 'all';
  return S.reviewItems().filter(r => f === 'all' || (f === 'flagged' ? !!r.flag : r.kind === f));
}

function currentReview(list) {
  return list.find(r => r.id === ui.reviewId) || list.find(r => r.status === 'pending') || list[0];
}

function nextPendingAfter(list, item) {
  const i = list.indexOf(item);
  const after = [...list.slice(i + 1), ...list.slice(0, i)];
  const next = after.find(r => r.status === 'pending');
  return next ? next.id : item.id;
}

function reviewRows(item) {
  const r = item.record;
  const row = (k, v) => v === '' || v == null ? '' : `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`;
  switch (item.kind) {
    case 'trip': return row('Date', prettyDate(r.date)) + row('Miles', num(r.miles) + ' mi') + row('Vehicle', r.vehicle) + row('Reason', r.purpose) + row('Notes', r.notes);
    case 'expense': return row('Date', prettyDate(r.date)) + row('Paid to', r.vendor) + row('For', r.notes) + row('Amount', money(r.amount)) + row('Category', r.category)
      + row('Paid with', r.paidPersonally ? 'Your own money (goes in the Journal too)' : r.paymentMethod);
    case 'job': return row('Date', prettyDate(r.date)) + row('Client', item.customerName || '—') + row('Amount', money(r.amount)) + row('Payment', r.paymentMethod) + row('Notes', r.notes);
    case 'payout': return row('Date', prettyDate(r.date)) + row('Paid to', S.workerName(r.workerId) || '?') + row('Amount', money(r.amount)) + row('Paid by', r.method) + row('Notes', r.notes);
    case 'contribution': return row('Date', prettyDate(r.date)) + row('Description', r.description) + row('Amount', money(r.amount))
      + row('Journal entry', `Dr ${r.debitAccount} / Cr ${S.EQUITY_ACCOUNT}`) + row('Notes', r.notes);
    default: return '';
  }
}

function renderReview() {
  const all = S.reviewItems();
  const list = reviewList();
  const item = currentReview(list);
  const count = st => all.filter(r => r.status === st).length;
  const done = count('approved') + count('skipped');
  const pos = item ? list.indexOf(item) + 1 : 0;
  const pendingHere = list.filter(r => r.status === 'pending' && !r.flag).length;

  view.innerHTML = `
    <header class="topbar"><a class="back" href="#/home">‹ Home</a><div class="topbar-actions"></div></header>
    <h1 class="page-title">Review your notes</h1>
    ${!all.length ? empty('Nothing to review.', '', '') : `
    <div class="review-progress">
      <div class="review-bar"><span style="width:${all.length ? (done / all.length) * 100 : 0}%"></span></div>
      <p><b>${done} of ${all.length}</b> reviewed · ${count('approved')} added · ${count('skipped')} skipped · ${count('pending')} left</p>
    </div>
    <div class="chips review-filters">
      ${REVIEW_KINDS.map(([k, l]) => {
        const n = k === 'all' ? all.length : all.filter(r => k === 'flagged' ? r.flag : r.kind === k).length;
        return n ? `<button class="chip-btn ${(ui.reviewFilter || 'all') === k ? 'on' : ''}" data-action="review-filter" data-filter="${k}">${l} <small>${n}</small></button>` : '';
      }).join('')}
    </div>
    ${item ? `
    <div class="review-grid">
      <section class="card review-card" aria-live="polite">
        <div class="review-head">
          <span class="badge kind-${item.kind}">${esc(KIND_LABEL[item.kind] || item.kind)}</span>
          <span class="muted">${pos} of ${list.length} · ${esc(item.source)}</span>
        </div>
        ${item.flag ? `<div class="flag-note"><b>Check this:</b> ${esc(item.flag)}</div>` : ''}
        <div class="info review-info">${reviewRows(item)}</div>
        ${item.status === 'pending' ? `
          <div class="review-actions">
            <button class="btn primary" data-action="review-add">Add <kbd>A</kbd></button>
            <button class="btn" data-action="review-edit">Edit first <kbd>E</kbd></button>
            <button class="btn" data-action="review-skip">Skip <kbd>S</kbd></button>
          </div>` : `
          <div class="review-done ${item.status}">
            <b>${item.status === 'approved' ? '✓ Added to your books' : 'Skipped — not added'}</b>
            <button class="btn" data-action="review-undo">Undo <kbd>U</kbd></button>
          </div>`}
        <div class="review-nav">
          <button class="btn" data-action="review-prev" ${list.length < 2 ? 'disabled' : ''}>‹ Previous</button>
          <button class="btn" data-action="review-next" ${list.length < 2 ? 'disabled' : ''}>Next ›</button>
        </div>
        <p class="fine">Keys: A add · E edit · S skip · U undo · ← → move</p>
        ${pendingHere > 1 ? `<button class="link" data-action="review-add-rest">Add all ${pendingHere} remaining entries in this view that don't need a look</button>` : ''}
      </section>
      <section class="card review-photo-card">
        <h3>${esc(item.source)} <small>click to zoom</small></h3>
        <div class="review-photo"><img src="notes/${esc(item.page)}.jpg" alt="Photo of your notebook page: ${esc(item.source)}" data-action="review-zoom"></div>
      </section>
    </div>` : `<p class="muted">Nothing in this view.</p>`}
    <details class="card review-all">
      <summary>All entries in this view (${list.length})</summary>
      <ul class="review-index">${list.map(r => `
        <li><button class="row ${r === item ? 'current' : ''}" data-action="review-go" data-id="${r.id}">
          <span class="dot ${r.status}" aria-label="${r.status}"></span>
          <span class="row-main"><b>${esc(shortDate(r.record.date))} · ${esc(reviewTitle(r))}</b></span>
          <span class="row-end"><b>${esc(reviewAmount(r))}</b>${r.flag ? '<small>needs a look</small>' : ''}</span>
        </button></li>`).join('')}</ul>
    </details>
    ${count('pending') === 0 ? `<section class="card"><h3>All done</h3>
      <p class="fine">${count('approved')} entries were added to your books and ${count('skipped')} were skipped.</p>
      <button class="btn block" data-action="review-clear">Clear the review list</button></section>` : ''}
    `}`;

  const img = view.querySelector('.review-photo img');
  if (img) img.addEventListener('error', () => { img.closest('.review-photo-card').hidden = true; });
}

function reviewTitle(r) {
  const x = r.record;
  return ({ trip: x.purpose, expense: [x.vendor, x.notes].filter(Boolean).join(' – '), job: r.customerName || x.notes,
    payout: S.workerName(x.workerId), contribution: x.description })[r.kind] || '';
}

function reviewAmount(r) {
  return r.kind === 'trip' ? num(r.record.miles) + ' mi' : money(r.record.amount);
}

function reviewPrepare(item) {
  const rec = JSON.parse(JSON.stringify(item.record));
  delete rec.id;
  if (item.kind === 'job') {
    rec.customerId = S.findOrCreateCustomer(item.customerName);
    rec.services = rec.services || [];
    rec.crew = rec.crew || [];
  }
  return rec;
}

function reviewApprove(item, list) {
  const saved = S.upsert(S.REVIEW_TARGET[item.kind], reviewPrepare(item));
  ui.reviewId = nextPendingAfter(list, item);
  S.setReviewStatus(item.id, 'approved', saved.id);
}

function reviewEdit(item, list) {
  const prefill = reviewPrepare(item);
  const opts = { onSaved: saved => { ui.reviewId = nextPendingAfter(list, item); S.setReviewStatus(item.id, 'approved', saved.id); } };
  ({
    trip: () => tripForm(prefill, opts),
    expense: () => expenseForm(prefill, opts),
    job: () => jobForm(prefill, '', opts),
    payout: () => payoutForm(prefill, {}, opts),
    contribution: () => contributionForm(prefill, opts),
  })[item.kind]();
}

function reviewAct(what) {
  const list = reviewList();
  const item = currentReview(list);
  if (!item) return;
  const i = list.indexOf(item);
  if (what === 'add' && item.status === 'pending') reviewApprove(item, list);
  else if (what === 'edit' && item.status === 'pending') reviewEdit(item, list);
  else if (what === 'skip' && item.status === 'pending') { ui.reviewId = nextPendingAfter(list, item); S.setReviewStatus(item.id, 'skipped'); }
  else if (what === 'undo' && item.status !== 'pending') {
    if (item.status === 'approved' && item.recordId) S.remove(S.REVIEW_TARGET[item.kind], item.recordId);
    ui.reviewId = item.id;
    S.setReviewStatus(item.id, 'pending');
  } else if (what === 'prev' || what === 'next') {
    ui.reviewId = list[(i + (what === 'next' ? 1 : -1) + list.length) % list.length].id;
    renderReview();
  }
}

document.addEventListener('keydown', e => {
  if (!current.startsWith('#/review') || sheetHandlers || document.querySelector('.dialog-backdrop')) return;
  if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  const map = { a: 'add', e: 'edit', s: 'skip', u: 'undo', ArrowLeft: 'prev', ArrowRight: 'next' };
  const what = map[e.key];
  if (!what) return;
  e.preventDefault();
  reviewAct(what);
});

// ---------------------------------------------------------------- EXPENSES & MILEAGE

function renderExpenses() {
  const d = S.get();
  const tab = ui.expenseTab;
  const addAction = tab === 'expenses' ? 'new-expense' : 'new-trip';
  let body;
  if (tab === 'expenses') {
    const list = [...d.expenses].sort(S.byDateDesc);
    body = !list.length ? empty('No expenses yet.', 'new-expense', 'Add an expense') :
      groupByMonth(list, e => Number(e.amount) || 0).map(g => `
        <div class="section-head"><h2>${esc(g.label)}</h2><span>${money(g.total)}</span></div>
        <ul class="list">${g.list.map(e => `
          <li><button class="row" data-action="edit-expense" data-id="${e.id}">
            <div class="row-main"><b>${esc(e.vendor || e.category || 'Expense')}</b>
              <small>${esc(shortDate(e.date))} · ${esc(e.category || '')}${e.paidPersonally ? ' · <span class="tag">Owner paid</span>' : ''}</small></div>
            <div class="row-end"><b>${money(e.amount)}</b><small>${esc(e.paymentMethod || '')}</small></div>
          </button></li>`).join('')}</ul>`).join('');
  } else {
    const list = [...d.mileage].sort(S.byDateDesc);
    const rate = Number(d.settings.mileageRate) || 0;
    body = !list.length ? empty('No trips logged yet.', 'new-trip', 'Log a trip') :
      groupByMonth(list, m => Number(m.miles) || 0).map(g => `
        <div class="section-head"><h2>${esc(g.label)}</h2><span>${num(g.total)} mi · ${money(g.total * rate)}</span></div>
        <ul class="list">${g.list.map(m => `
          <li><button class="row" data-action="edit-trip" data-id="${m.id}">
            <div class="row-main"><b>${esc(m.purpose || 'Business trip')}</b>
              <small>${esc(shortDate(m.date))}${m.vehicle ? ' · ' + esc(m.vehicle) : ''}${m.customerId ? ' · ' + esc(S.customerName(m.customerId)) : ''}</small></div>
            <div class="row-end"><b>${num(m.miles)} mi</b><small>${money((Number(m.miles) || 0) * rate)}</small></div>
          </button></li>`).join('')}</ul>`).join('');
  }
  view.innerHTML = `
    ${header('Expenses', addButton(addAction, tab === 'expenses' ? 'New expense' : 'New trip'))}
    <div class="segmented">
      <button data-action="expense-tab" data-tab="expenses" class="${tab === 'expenses' ? 'on' : ''}">Expenses</button>
      <button data-action="expense-tab" data-tab="mileage" class="${tab === 'mileage' ? 'on' : ''}">Mileage</button>
    </div>
    ${body}`;
}

function expenseForm(e = {}, opts = {}) {
  const d = S.get();
  const isNew = !e.id;
  const exp = { date: isoDate(), category: d.settings.expenseCategories[0], paymentMethod: 'Card', ...e };
  const cats = d.settings.expenseCategories.includes(exp.category) || !exp.category ? d.settings.expenseCategories : [...d.settings.expenseCategories, exp.category];
  openSheet({
    title: isNew ? 'New expense' : 'Edit expense',
    body: `
      ${field('Date', `<input name="date" type="date" required value="${esc(exp.date)}">`)}
      ${field('Amount', `<input name="amount" type="number" inputmode="decimal" step="0.01" min="0" required value="${esc(exp.amount)}" placeholder="0.00">`)}
      ${field('Vendor', `<input name="vendor" value="${esc(exp.vendor)}" placeholder="Chemical Guys, AutoZone, Shell…">`)}
      ${field('Category', `<select name="category">${options(cats, exp.category)}</select>`)}
      ${field('Payment method', `<select name="paymentMethod">${options(['Card', 'Cash', 'Business account', 'Personal card', 'Personal cash', 'Other'], exp.paymentMethod)}</select>`)}
      ${toggle('paidPersonally', exp.paidPersonally, 'Paid with personal money',
        'Also records this as an owner contribution in the Journal.')}
      ${field('Notes', `<textarea name="notes" rows="3">${esc(exp.notes)}</textarea>`)}
    `,
    onSave: v => {
      const saved = S.upsert('expenses', {
        ...e, date: v.date, amount: parseFloat(v.amount) || 0, vendor: v.vendor.trim(), category: v.category,
        paymentMethod: v.paymentMethod, paidPersonally: v.paidPersonally, notes: v.notes.trim(),
      });
      if (opts.onSaved) opts.onSaved(saved);
    },
    onDelete: isNew ? null : () => S.remove('expenses', e.id),
    deleteLabel: 'Delete expense',
    onMount: f => {
      f.elements.paymentMethod.addEventListener('change', () => {
        if (/^Personal/.test(f.elements.paymentMethod.value)) f.elements.paidPersonally.checked = true;
      });
    },
  });
}

function tripForm(m = {}, opts = {}) {
  const d = S.get();
  const isNew = !m.id;
  const trip = { date: isoDate(), ...m };
  const vehicles = [...new Set(d.mileage.map(t => t.vehicle).filter(Boolean))].sort();
  if (isNew && !m.vehicle && d.mileage.length) trip.vehicle = [...d.mileage].sort(S.byDateDesc)[0].vehicle || '';
  const customers = [...d.customers].sort((a, b) => a.name.localeCompare(b.name)).map(c => ({ value: c.id, label: c.name }));
  const form = openSheet({
    title: isNew ? 'Log trip' : 'Edit trip',
    body: `
      ${field('Date', `<input name="date" type="date" required value="${esc(trip.date)}">`)}
      ${field('Miles', `<input name="miles" type="number" inputmode="decimal" step="0.1" min="0" required value="${esc(trip.miles)}" placeholder="0.0">`,
        'Or fill in the odometer readings below and miles are calculated for you.')}
      <div class="grid2">
        ${field('Start odometer', `<input name="odoStart" type="number" inputmode="decimal" value="${esc(trip.odoStart)}">`)}
        ${field('End odometer', `<input name="odoEnd" type="number" inputmode="decimal" value="${esc(trip.odoEnd)}">`)}
      </div>
      ${field('Purpose', `<input name="purpose" value="${esc(trip.purpose)}" placeholder="Job at customer, supply run…">`)}
      ${field('Vehicle', `<input name="vehicle" list="vehicle-list" value="${esc(trip.vehicle)}" placeholder="F-150, Baymax…" autocomplete="off">
        <datalist id="vehicle-list">${options(vehicles)}</datalist>`)}
      ${field('Customer (optional)', `<select name="customerId">${options(customers, trip.customerId, { blank: 'None' })}</select>`)}
      ${isNew ? toggle('roundTrip', false, 'Round trip', 'Doubles the miles when you save.') : ''}
      ${field('Notes', `<textarea name="notes" rows="2">${esc(trip.notes)}</textarea>`)}
    `,
    onSave: v => {
      let miles = parseFloat(v.miles) || 0;
      if (v.roundTrip) miles *= 2;
      const saved = S.upsert('mileage', {
        ...m, date: v.date, miles, odoStart: v.odoStart, odoEnd: v.odoEnd, vehicle: v.vehicle.trim(),
        purpose: v.purpose.trim(), customerId: v.customerId, notes: v.notes.trim(),
      });
      if (opts.onSaved) opts.onSaved(saved);
    },
    onDelete: isNew ? null : () => S.remove('mileage', m.id),
    deleteLabel: 'Delete trip',
  });
  const calc = () => {
    const a = parseFloat(form.elements.odoStart.value), b = parseFloat(form.elements.odoEnd.value);
    if (!isNaN(a) && !isNaN(b) && b >= a) form.elements.miles.value = (b - a).toFixed(1);
  };
  form.elements.odoStart.addEventListener('input', calc);
  form.elements.odoEnd.addEventListener('input', calc);
}

// ---------------------------------------------------------------- JOURNAL (owner contributions)

function renderJournal() {
  const list = S.allContributions();
  const total = list.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const ytd = S.summarize(periodRange('year', 0)).contributed;

  view.innerHTML = `
    ${header('Owner Journal', addButton('new-contribution', 'New journal entry'))}
    <section class="hero card">
      <span class="label">Owner contributions to date</span>
      <span class="hero-num">${money(total)}</span>
      <span class="sub">${money(ytd)} this year · credited to ${esc(S.EQUITY_ACCOUNT)}</span>
    </section>
    <p class="fine pad">Record money or property you put into the business from personal funds. Expenses marked “Paid with personal money” show up here automatically.</p>
    ${!list.length ? empty('No journal entries yet.', 'new-contribution', 'Add a journal entry') : ''}
    ${groupByMonth(list, c => Number(c.amount) || 0).map(g => `
      <div class="section-head"><h2>${esc(g.label)}</h2><span>${money(g.total)}</span></div>
      <ul class="list">${g.list.map(c => `
        <li><button class="row journal" data-action="${c.source === 'expense' ? 'edit-expense' : 'edit-contribution'}" data-id="${c.source === 'expense' ? c.expenseId : c.id}">
          <div class="row-main">
            <b>${esc(c.description || 'Owner contribution')}</b>
            <small>${esc(shortDate(c.date))}${c.source === 'expense' ? ' · <span class="tag">From expense</span>' : ''}</small>
            <div class="entry">
              <span>Dr ${esc(c.debitAccount)}</span><span>${money(c.amount)}</span>
              <span class="cr">Cr ${esc(S.EQUITY_ACCOUNT)}</span><span>${money(c.amount)}</span>
            </div>
          </div>
        </button></li>`).join('')}</ul>`).join('')}
  `;
}

function contributionForm(c = {}, opts = {}) {
  const isNew = !c.id;
  const entry = { date: isoDate(), debitAccount: S.CONTRIBUTION_ACCOUNTS[0], ...c };
  const accounts = S.CONTRIBUTION_ACCOUNTS.includes(entry.debitAccount) ? S.CONTRIBUTION_ACCOUNTS : [...S.CONTRIBUTION_ACCOUNTS, entry.debitAccount];
  const form = openSheet({
    title: isNew ? 'Owner contribution' : 'Edit entry',
    body: `
      ${field('Date', `<input name="date" type="date" required value="${esc(entry.date)}">`)}
      ${field('Description', `<input name="description" required value="${esc(entry.description)}" placeholder="Bought pressure washer with personal card">`)}
      ${field('Amount', `<input name="amount" type="number" inputmode="decimal" step="0.01" min="0" required value="${esc(entry.amount)}" placeholder="0.00">`)}
      ${field('What did the money go to? (debit)', `<select name="debitAccount">${options(accounts, entry.debitAccount)}</select>`,
        'Pick “Cash – Business Account” if you moved money into the business account.')}
      <div class="entry-preview card">
        <div><span>Debit</span><b data-preview="dr"></b><b data-preview="amt"></b></div>
        <div><span>Credit</span><b>${esc(S.EQUITY_ACCOUNT)}</b><b data-preview="amt"></b></div>
      </div>
      ${field('Notes', `<textarea name="notes" rows="3">${esc(entry.notes)}</textarea>`)}
    `,
    onSave: v => {
      const saved = S.upsert('contributions', {
        ...c, date: v.date, description: v.description.trim(), amount: parseFloat(v.amount) || 0,
        debitAccount: v.debitAccount, notes: v.notes.trim(),
      });
      if (opts.onSaved) opts.onSaved(saved);
    },
    onDelete: isNew ? null : () => S.remove('contributions', c.id),
    deleteLabel: 'Delete entry',
  });
  const preview = () => {
    form.querySelector('[data-preview=dr]').textContent = form.elements.debitAccount.value;
    form.querySelectorAll('[data-preview=amt]').forEach(el => { el.textContent = money(form.elements.amount.value); });
  };
  form.addEventListener('input', preview);
  form.addEventListener('change', preview);
  preview();
}

// ---------------------------------------------------------------- SETTINGS

function renderSettings() {
  const s = S.get().settings;
  const d = S.get();
  view.innerHTML = `
    <header class="topbar"><a class="back" href="#/home">‹ Home</a><div class="topbar-actions"></div></header>
    <h1 class="page-title">Settings</h1>
    <form class="card settings-form" data-form="settings">
      ${field('Business name', `<input name="businessName" value="${esc(s.businessName)}">`)}
      ${field('Mileage rate ($ per mile)', `<input name="mileageRate" type="number" inputmode="decimal" step="0.005" min="0" value="${esc(s.mileageRate)}">`,
        'Use the current IRS standard mileage rate for business.')}
      ${field('1099-NEC threshold ($)', `<input name="reportThreshold1099" type="number" inputmode="decimal" step="1" min="0" value="${esc(s.reportThreshold1099)}">`,
        'Crew paid this much or more in a year are flagged for a 1099-NEC.')}
      ${field('Services & prices', `<textarea name="services" rows="8">${esc(s.services.map(x => `${x.name}, ${x.price}`).join('\n'))}</textarea>`,
        'One per line: <i>Service name, price</i>')}
      ${field('Expense categories', `<textarea name="expenseCategories" rows="8">${esc(s.expenseCategories.join('\n'))}</textarea>`, 'One per line')}
      <button class="btn primary block" type="submit">Save settings</button>
    </form>

    <div class="section-head"><h2>Backup</h2></div>
    <section class="card stack">
      <p class="fine" id="sync-line">${esc(statusLine())}</p>
      <p class="fine">Export a backup now and then and keep it in Files or iCloud Drive.</p>
      <button class="btn block" data-action="export-json">Export backup</button>
      <label class="btn block file-btn">Restore from backup<input type="file" accept="application/json,.json" data-action="import-json" hidden></label>
    </section>

    <div class="section-head"><h2>Spreadsheets (CSV)</h2></div>
    <section class="card stack">
      <button class="btn block" data-action="csv" data-kind="jobs">Jobs (${d.jobs.length})</button>
      <button class="btn block" data-action="csv" data-kind="expenses">Expenses (${d.expenses.length})</button>
      <button class="btn block" data-action="csv" data-kind="mileage">Mileage log (${d.mileage.length})</button>
      <button class="btn block" data-action="csv" data-kind="contributions">Owner journal (${S.allContributions().length})</button>
      <button class="btn block" data-action="csv" data-kind="customers">Customers (${d.customers.length})</button>
      <button class="btn block" data-action="csv" data-kind="payouts">Crew payments (${d.payouts.length})</button>
      <button class="btn block" data-action="csv" data-kind="workers">Crew &amp; 1099 totals (${d.workers.length})</button>
    </section>

    <div class="section-head"><h2>Danger zone</h2></div>
    <section class="card stack">
      <button class="btn danger block" data-action="reset">Erase all data</button>
    </section>
    <p class="fine center">Detailing Tracker · data saved on this device</p>
  `;
}

view.addEventListener('submit', e => {
  if (e.target.dataset.form !== 'settings') return;
  e.preventDefault();
  const v = Object.fromEntries(new FormData(e.target).entries());
  const services = v.services.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const m = l.match(/^(.*?)[,\t]\s*\$?([\d.]+)\s*$/);
    return m ? { name: m[1].trim(), price: parseFloat(m[2]) || 0 } : { name: l, price: 0 };
  });
  const expenseCategories = v.expenseCategories.split('\n').map(l => l.trim()).filter(Boolean);
  S.updateSettings({
    businessName: v.businessName.trim(),
    mileageRate: parseFloat(v.mileageRate) || 0,
    reportThreshold1099: parseFloat(v.reportThreshold1099) || 0,
    services,
    expenseCategories: expenseCategories.length ? expenseCategories : [...S.DEFAULT_EXPENSE_CATEGORIES],
  });
  toast('Settings saved');
});

// ---------------------------------------------------------------- actions

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 1800);
}

const actions = {
  'new-customer': () => customerForm(),
  'edit-customer': el => customerForm(S.find('customers', el.dataset.id)),
  'new-vehicle': el => vehicleForm(el.dataset.id),
  'edit-vehicle': el => vehicleForm(el.dataset.id, el.dataset.vid),
  'new-job': el => jobForm({}, el.dataset.customer || ''),
  'edit-job': el => jobForm(S.find('jobs', el.dataset.id)),
  'new-expense': () => expenseForm(),
  'edit-expense': el => expenseForm(S.find('expenses', el.dataset.id)),
  'new-trip': () => tripForm(),
  'edit-trip': el => tripForm(S.find('mileage', el.dataset.id)),
  'new-contribution': () => contributionForm(),
  'edit-contribution': el => contributionForm(S.find('contributions', el.dataset.id)),
  'review-add': () => reviewAct('add'),
  'review-edit': () => reviewAct('edit'),
  'review-skip': () => reviewAct('skip'),
  'review-undo': () => reviewAct('undo'),
  'review-prev': () => reviewAct('prev'),
  'review-next': () => reviewAct('next'),
  'review-go': el => { ui.reviewId = el.dataset.id; renderReview(); window.scrollTo(0, 0); },
  'review-filter': el => { ui.reviewFilter = el.dataset.filter; ui.reviewId = ''; renderReview(); },
  'review-zoom': el => el.closest('.review-photo').classList.toggle('zoomed'),
  'review-add-rest': async () => {
    const list = reviewList();
    const rest = list.filter(r => r.status === 'pending' && !r.flag);
    if (!await askConfirm(`Add all ${rest.length} remaining entries in this view exactly as transcribed? Entries marked "needs a look" stay for you to check one at a time.`, { ok: `Add ${rest.length}` })) return;
    for (const r of rest) {
      const saved = S.upsert(S.REVIEW_TARGET[r.kind], reviewPrepare(r));
      r.status = 'approved';
      r.recordId = saved.id;
    }
    ui.reviewId = '';
    S.setReviewStatus(rest[rest.length - 1].id, 'approved', rest[rest.length - 1].recordId);
    toast(`Added ${rest.length} entries`);
  },
  'review-clear': () => { S.clearFinishedReview(); go('#/home'); },
  'new-worker': () => workerForm(),
  'edit-worker': el => workerForm(S.find('workers', el.dataset.id)),
  'new-payout': el => payoutForm({}, { worker: el.dataset.worker, amount: el.dataset.amount }),
  'edit-payout': el => payoutForm(S.find('payouts', el.dataset.id)),
  'crew-year': el => { ui.crewYear += Number(el.dataset.step); renderCrew(); },
  'expense-tab': el => { ui.expenseTab = el.dataset.tab; renderExpenses(); },
  'period': el => { ui.period = el.dataset.period; ui.offset = 0; renderHome(); },
  'period-prev': () => { ui.offset -= 1; renderHome(); },
  'period-next': () => { if (ui.offset < 0) { ui.offset += 1; renderHome(); } },
  'chart-tip': el => {
    const chart = el.closest('.chart');
    const tip = chart.querySelector('.chart-tip');
    chart.querySelectorAll('.chart-col.sel').forEach(c => c.classList.remove('sel'));
    el.classList.add('sel');
    tip.textContent = el.dataset.tip;
    tip.hidden = false;
  },
  'export-json': () => saveFile(`detailing-backup-${isoDate()}.json`, S.exportJSON(), 'application/json'),
  'csv': el => saveFile(`${el.dataset.kind}-${isoDate()}.csv`, S.csvFor(el.dataset.kind), 'text/csv'),
  'reset': async () => {
    const yes = await askConfirm('Erase ALL clients, jobs, crew, payments, expenses, mileage and journal entries? This cannot be undone. Export a backup first if you might need it.', { ok: 'Erase everything', danger: true });
    if (!yes) return;
    S.resetAll();
    toast('All data erased');
  },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'INPUT' || !actions[el.dataset.action]) return;
  e.preventDefault();
  actions[el.dataset.action](el);
});

view.addEventListener('change', e => {
  if (e.target.dataset.action !== 'import-json') return;
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  file.text()
    .then(async text => {
      JSON.parse(text); // fail early on a file that isn't a backup
      if (!await askConfirm('Replace everything in the app with this backup?', { ok: 'Restore', danger: true })) return;
      S.importJSON(text);
      toast('Backup restored');
    })
    .catch(err => askConfirm('Could not restore: ' + (err instanceof SyntaxError ? 'that file is not a backup.' : err.message), { cancel: '' }));
});

// Only the results re-render, so the keyboard stays up while typing.
view.addEventListener('input', e => {
  const kind = e.target.dataset.search;
  if (!kind) return;
  const results = $('#results', view);
  if (kind === 'customer') { ui.customerSearch = e.target.value; results.innerHTML = customerResults(); }
  if (kind === 'job') { ui.jobSearch = e.target.value; results.innerHTML = jobResults(); }
});

// ---------------------------------------------------------------- boot

route();

// Keep the save indicator current without redrawing the page on every save.
let lastBanner = '';
S.onStatus(() => {
  const line = document.getElementById('sync-line');
  if (line) line.textContent = statusLine();
  const banner = statusBanner();
  if (banner !== lastBanner) { lastBanner = banner; if (!sheetHandlers) rerender(); }
});
S.connectCloud();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !sheetHandlers) S.refreshFromCloud();
});

if (!IN_CLAUDE && 'serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service worker not registered', err));
}
