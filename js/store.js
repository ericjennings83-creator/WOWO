// Data layer: everything lives in this phone's localStorage under one key.
// Use Settings → Backup regularly; iOS can clear site data for web apps
// that are not added to the Home Screen.

const STORAGE_KEY = 'wowo-detailing-v1';

export const DEFAULT_SERVICES = [
  { name: 'Exterior Wash', price: 50 },
  { name: 'Interior Detail', price: 120 },
  { name: 'Full Detail', price: 200 },
  { name: 'Wax / Sealant', price: 75 },
  { name: 'Clay Bar', price: 60 },
  { name: 'Paint Correction', price: 350 },
  { name: 'Ceramic Coating', price: 800 },
  { name: 'Headlight Restoration', price: 80 },
  { name: 'Engine Bay', price: 60 },
  { name: 'Pet Hair Removal', price: 40 },
  { name: 'Odor Removal', price: 60 },
];

export const DEFAULT_EXPENSE_CATEGORIES = [
  'Supplies & Chemicals',
  'Equipment & Tools',
  'Fuel',
  'Vehicle Maintenance',
  'Insurance',
  'Advertising & Marketing',
  'Phone & Software',
  'Water & Power',
  'Licenses & Fees',
  'Uniforms',
  'Other',
];

export const PAYMENT_METHODS = ['Cash', 'Card', 'Venmo', 'Zelle', 'Cash App', 'PayPal', 'Check', 'Other'];

// Accounts an owner contribution can be debited to. The credit side is
// always Owner's Capital (equity).
export const CONTRIBUTION_ACCOUNTS = [
  'Cash – Business Account',
  'Equipment',
  'Vehicle',
  'Supplies Expense',
  'Fuel Expense',
  'Insurance Expense',
  'Advertising Expense',
  'Phone & Software Expense',
  'Licenses & Fees Expense',
  'Other Expense',
];
export const EQUITY_ACCOUNT = "Owner's Capital";

// Maps an expense category to the account debited when the owner paid for it
// personally.
export function accountForExpenseCategory(category) {
  const map = {
    'Supplies & Chemicals': 'Supplies Expense',
    'Equipment & Tools': 'Equipment',
    'Fuel': 'Fuel Expense',
    'Vehicle Maintenance': 'Vehicle',
    'Insurance': 'Insurance Expense',
    'Advertising & Marketing': 'Advertising Expense',
    'Phone & Software': 'Phone & Software Expense',
    'Licenses & Fees': 'Licenses & Fees Expense',
  };
  return map[category] || 'Other Expense';
}

function emptyData() {
  return {
    version: 1,
    customers: [],
    jobs: [],
    expenses: [],
    mileage: [],
    contributions: [],
    workers: [],
    payouts: [],
    review: [],
    settings: {
      businessName: 'My Detailing',
      mileageRate: 0.70,
      reportThreshold1099: 2000,
      services: DEFAULT_SERVICES.map(s => ({ ...s })),
      expenseCategories: [...DEFAULT_EXPENSE_CATEGORIES],
    },
  };
}

function normalize(d) {
  const base = emptyData();
  const out = { ...base, ...d, settings: { ...base.settings, ...(d && d.settings) } };
  for (const k of ['customers', 'jobs', 'expenses', 'mileage', 'contributions', 'workers', 'payouts', 'review']) {
    if (!Array.isArray(out[k])) out[k] = [];
  }
  for (const c of out.customers) if (!Array.isArray(c.vehicles)) c.vehicles = [];
  for (const j of out.jobs) if (!Array.isArray(j.crew)) j.crew = [];
  return out;
}

let data = load();
const listeners = new Set();
const statusListeners = new Set();

// Where data is kept: 'device' (this browser only) or, when the app runs on
// claude.ai, 'cloud' (the owner's private space in the artifact's database).
let status = { mode: 'device', state: 'idle' };

function setStatus(patch) {
  status = { ...status, ...patch };
  statusListeners.forEach(fn => fn(status));
}

export function onStatus(fn) { statusListeners.add(fn); }
export function getStatus() { return status; }

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalize(JSON.parse(raw)) : emptyData();
  } catch (e) {
    console.error('Could not load saved data', e);
    return emptyData();
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    // Device storage can be full or blocked. In cloud mode that's fine;
    // otherwise tell the user.
    if (status.mode !== 'cloud') setStatus({ state: 'error', message: 'Could not save on this device. Export a backup from Settings.' });
  }
  listeners.forEach(fn => fn());
  if (status.mode === 'cloud') scheduleSync();
}

export function onChange(fn) { listeners.add(fn); }

// ---------- claude.ai cloud storage ----------
// Records are grouped into documents so each stays well under the store's
// 256 KiB limit: dated records by month, the rest into 8 hash buckets.

const DATED = ['jobs', 'expenses', 'mileage', 'contributions', 'payouts'];
const UNDATED = ['customers', 'workers'];
let cloud = null; // { db, base }
let synced = new Map(); // doc id -> JSON last written
let syncTimer = null;
let syncing = null;

function bucketHash(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 8;
}

function toDocs(d) {
  const docs = new Map([['settings__main', { settings: d.settings, version: d.version }]]);
  const put = (key, item) => {
    if (!docs.has(key)) docs.set(key, { items: {} });
    docs.get(key).items[item.id] = item;
  };
  for (const c of DATED) for (const it of d[c]) put(`${c}__${(it.date || 'nodate').slice(0, 7)}`, it);
  for (const c of UNDATED) for (const it of d[c]) put(`${c}__b${bucketHash(it.id)}`, it);
  // Entries waiting for review stay in one document until they're all handled.
  for (const it of d.review) put('review__main', it);
  return docs;
}

function fromDocs(snaps) {
  const out = emptyData();
  for (const s of snaps) {
    const [name] = s.id.split('__');
    const body = s.data() || {};
    if (name === 'settings') out.settings = { ...out.settings, ...body.settings };
    else if (out[name]) out[name].push(...Object.values(body.items || {}).map(x => JSON.parse(JSON.stringify(x))));
  }
  return normalize(out);
}

function hasAnyRecords(d) {
  return [...DATED, ...UNDATED].some(c => d[c].length);
}

export async function connectCloud() {
  const c = typeof window !== 'undefined' && window.claude && typeof window.claude.use === 'function' ? window.claude : null;
  if (!c) return;
  setStatus({ mode: 'device', state: 'connecting' });
  try {
    const [db, user] = await Promise.all([c.use('db'), c.use('user')]);
    const id = user && await user.id();
    if (!db || !id) { setStatus({ mode: 'device', state: 'idle', cloudUnavailable: true }); return; }
    cloud = { db, base: `data/users/${id}` };
    await pullCloud(true);
  } catch (e) {
    console.error('Cloud storage unavailable', e);
    setStatus({ mode: 'device', state: 'idle', cloudUnavailable: true });
  }
}

async function pullCloud(first = false) {
  const snap = await cloud.db.collection(cloud.base).get();
  const remote = fromDocs(snap.docs.filter(s => s.exists));
  synced = new Map(snap.docs.filter(s => s.exists).map(s => [s.id, JSON.stringify(s.data())]));
  if (first && !snap.docs.length && hasAnyRecords(data)) {
    // First run on this account: move what's on this device up to the cloud.
    setStatus({ mode: 'cloud', state: 'saving' });
    await syncNow();
    return;
  }
  data = remote;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) { /* cache only */ }
  setStatus({ mode: 'cloud', state: 'saved' });
  listeners.forEach(fn => fn());
}

// Re-read when the app comes back to the foreground, so edits made on
// another device show up.
export async function refreshFromCloud() {
  if (!cloud || syncing || syncTimer) return;
  try { await pullCloud(); } catch (e) { /* keep what we have */ }
}

function scheduleSync() {
  setStatus({ state: 'saving' });
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncTimer = null; syncNow(); }, 400);
}

async function syncNow() {
  if (syncing) { await syncing; return scheduleSync(); }
  syncing = (async () => {
    const docs = toDocs(data);
    const col = cloud.db.collection(cloud.base);
    try {
      // One write at a time, only for documents that changed.
      for (const [id, body] of docs) {
        const json = JSON.stringify(body);
        if (synced.get(id) === json) continue;
        await col.doc(id).set(body);
        synced.set(id, json);
      }
      for (const id of [...synced.keys()]) {
        if (docs.has(id)) continue;
        await col.doc(id).delete();
        synced.delete(id);
      }
      setStatus({ mode: 'cloud', state: 'saved', message: '' });
    } catch (e) {
      console.error('Cloud save failed', e);
      const full = e && e.code === 'quota_exceeded';
      setStatus({ state: 'error', message: full ? 'Cloud storage is full. Export a backup, then delete old records.' : 'Could not save to the cloud. Your changes are kept on this device and will retry on your next change.' });
    }
  })();
  await syncing;
  syncing = null;
}

export function get() { return data; }

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Generic CRUD over the top-level collections.
export function upsert(collection, item) {
  const list = data[collection];
  if (!item.id) item.id = uid();
  const i = list.findIndex(x => x.id === item.id);
  if (i >= 0) list[i] = item; else list.push(item);
  save();
  return item;
}

export function remove(collection, id) {
  data[collection] = data[collection].filter(x => x.id !== id);
  save();
}

export function find(collection, id) {
  return data[collection].find(x => x.id === id);
}

export function updateSettings(patch) {
  data.settings = { ...data.settings, ...patch };
  save();
}

export function deleteCustomer(id) {
  data.customers = data.customers.filter(c => c.id !== id);
  // Keep job history but detach it from the removed customer.
  for (const j of data.jobs) if (j.customerId === id) { j.customerId = ''; j.vehicleId = ''; }
  for (const m of data.mileage) if (m.customerId === id) m.customerId = '';
  save();
}

// ---------- review queue ----------
// Entries transcribed from the owner's notes wait here until approved,
// edited or skipped. Approving creates a real record and remembers its id
// so the approval can be undone.

export const REVIEW_TARGET = { trip: 'mileage', expense: 'expenses', job: 'jobs', payout: 'payouts', contribution: 'contributions' };

export function reviewItems() {
  return [...data.review].sort((a, b) => (a.seq || 0) - (b.seq || 0));
}

export function setReviewStatus(id, status, recordId = '') {
  const it = data.review.find(r => r.id === id);
  if (!it) return;
  it.status = status;
  it.recordId = recordId;
  save();
}

export function clearFinishedReview() {
  data.review = data.review.filter(r => r.status === 'pending');
  save();
}

export function findOrCreateCustomer(name) {
  const clean = (name || '').trim();
  if (!clean) return '';
  const found = data.customers.find(c => c.name.trim().toLowerCase() === clean.toLowerCase());
  if (found) return found.id;
  const c = { id: uid(), name: clean, phone: '', email: '', address: '', notes: 'Added from notebook review', vehicles: [], createdAt: new Date().toISOString().slice(0, 10) };
  data.customers.push(c);
  return c.id;
}

// A worker with jobs or payments keeps their history; only unused ones can be deleted.
export function workerHasHistory(id) {
  return data.payouts.some(p => p.workerId === id) || data.jobs.some(j => (j.crew || []).some(c => c.workerId === id));
}

export function exportJSON() {
  return JSON.stringify(data, null, 2);
}

export function importJSON(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.customers)) {
    throw new Error('That file does not look like a detailing backup.');
  }
  data = normalize(parsed);
  save();
}

export function resetAll() {
  data = emptyData();
  save();
}

// ---------- derived data ----------

export function customerName(id) {
  const c = id && find('customers', id);
  return c ? c.name : '';
}

export function vehicleLabel(customerId, vehicleId) {
  const c = customerId && find('customers', customerId);
  const v = c && c.vehicles.find(v => v.id === vehicleId);
  return v ? describeVehicle(v) : '';
}

export function describeVehicle(v) {
  return [v.year, v.color, v.make, v.model].filter(Boolean).join(' ') || 'Vehicle';
}

export function jobTotal(j) {
  return (Number(j.amount) || 0) + (Number(j.tip) || 0);
}

// ---------- crew payroll (1099 contractors paid a commission on the job price) ----------

export function workerName(id) {
  const w = id && find('workers', id);
  return w ? w.name : '';
}

export function crewPay(job, member) {
  return Math.round((Number(job.amount) || 0) * (Number(member.pct) || 0)) / 100;
}

export function jobCommission(job) {
  return (job.crew || []).reduce((s, m) => s + crewPay(job, m), 0);
}

export function workerEarnings(workerId, range) {
  const within = x => !range || inRange(x.date, range);
  const jobs = data.jobs
    .filter(j => within(j) && (j.crew || []).some(m => m.workerId === workerId))
    .map(j => ({ job: j, pay: crewPay(j, j.crew.find(m => m.workerId === workerId)) }))
    .sort((a, b) => byDateDesc(a.job, b.job));
  const payouts = data.payouts.filter(p => p.workerId === workerId && within(p)).sort(byDateDesc);
  const earned = jobs.reduce((s, x) => s + x.pay, 0);
  const paid = payouts.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  return { jobs, payouts, earned, paid, owed: earned - paid };
}

export function totalOwedToCrew() {
  return data.workers.reduce((s, w) => s + Math.max(0, workerEarnings(w.id).owed), 0);
}

// Every owner contribution: ones entered by hand plus ones implied by
// expenses the owner paid for with personal money.
export function allContributions() {
  const manual = data.contributions.map(c => ({ ...c, source: 'manual' }));
  const fromExpenses = data.expenses
    .filter(e => e.paidPersonally)
    .map(e => ({
      id: 'exp-' + e.id,
      expenseId: e.id,
      date: e.date,
      description: [e.vendor, e.category].filter(Boolean).join(' – ') || 'Expense paid personally',
      amount: Number(e.amount) || 0,
      debitAccount: e.journalAccount || accountForExpenseCategory(e.category),
      notes: e.notes || '',
      source: 'expense',
    }));
  return [...manual, ...fromExpenses].sort(byDateDesc);
}

export function byDateDesc(a, b) {
  return (b.date || '').localeCompare(a.date || '') || (b.id || '').localeCompare(a.id || '');
}

export function inRange(dateStr, range) {
  return dateStr >= range.start && dateStr <= range.end;
}

export function summarize(range) {
  const jobs = data.jobs.filter(j => inRange(j.date, range));
  const expenses = data.expenses.filter(e => inRange(e.date, range));
  const trips = data.mileage.filter(m => inRange(m.date, range));
  const contributions = allContributions().filter(c => inRange(c.date, range));

  const revenue = jobs.reduce((s, j) => s + (Number(j.amount) || 0), 0);
  const tips = jobs.reduce((s, j) => s + (Number(j.tip) || 0), 0);
  const unpaid = jobs.filter(j => !j.paid).reduce((s, j) => s + jobTotal(j), 0);
  const expenseTotal = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const miles = trips.reduce((s, m) => s + (Number(m.miles) || 0), 0);
  const mileageDeduction = miles * (Number(data.settings.mileageRate) || 0);
  const contributed = contributions.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const payouts = data.payouts.filter(p => inRange(p.date, range));
  const laborPaid = payouts.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const laborEarned = jobs.reduce((s, j) => s + jobCommission(j), 0);

  const byService = {};
  for (const j of jobs) {
    const names = j.services && j.services.length ? j.services : ['(No service listed)'];
    const share = (Number(j.amount) || 0) / names.length;
    for (const n of names) {
      byService[n] = byService[n] || { name: n, count: 0, revenue: 0 };
      byService[n].count += 1;
      byService[n].revenue += share;
    }
  }
  const byCategory = {};
  for (const e of expenses) {
    const k = e.category || 'Other';
    byCategory[k] = (byCategory[k] || 0) + (Number(e.amount) || 0);
  }
  const byCustomer = {};
  for (const j of jobs) {
    const k = customerName(j.customerId) || 'Walk-in / unknown';
    byCustomer[k] = (byCustomer[k] || 0) + jobTotal(j);
  }

  return {
    jobs, expenses, trips, contributions,
    revenue, tips, income: revenue + tips, unpaid,
    expenseTotal, miles, mileageDeduction, contributed,
    payouts, laborPaid, laborEarned, owedToCrew: totalOwedToCrew(),
    profit: revenue + tips - expenseTotal - laborPaid,
    taxableEstimate: revenue + tips - expenseTotal - laborPaid - mileageDeduction,
    byService: Object.values(byService).sort((a, b) => b.revenue - a.revenue),
    byCategory: Object.entries(byCategory).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total),
    byCustomer: Object.entries(byCustomer).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total),
  };
}

// ---------- CSV ----------

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCSV(rows) {
  return rows.map(r => r.map(csvCell).join(',')).join('\n');
}

export function csvFor(kind) {
  const d = data;
  switch (kind) {
    case 'jobs':
      return toCSV([
        ['Date', 'Customer', 'Vehicle', 'Services', 'Amount', 'Tip', 'Total', 'Payment', 'Paid', 'Crew', 'Crew commission', 'Notes'],
        ...[...d.jobs].sort(byDateDesc).map(j => [
          j.date, customerName(j.customerId), vehicleLabel(j.customerId, j.vehicleId),
          (j.services || []).join('; '), j.amount, j.tip, jobTotal(j), j.paymentMethod, j.paid ? 'Yes' : 'No',
          (j.crew || []).map(m => `${workerName(m.workerId)} ${m.pct}%`).join('; '), jobCommission(j), j.notes,
        ]),
      ]);
    case 'expenses':
      return toCSV([
        ['Date', 'Vendor', 'Category', 'Amount', 'Payment', 'Paid personally', 'Notes'],
        ...[...d.expenses].sort(byDateDesc).map(e => [
          e.date, e.vendor, e.category, e.amount, e.paymentMethod, e.paidPersonally ? 'Yes' : 'No', e.notes,
        ]),
      ]);
    case 'mileage':
      return toCSV([
        ['Date', 'Vehicle', 'Miles', 'Start odometer', 'End odometer', 'Purpose', 'Customer', 'Notes'],
        ...[...d.mileage].sort(byDateDesc).map(m => [
          m.date, m.vehicle, m.miles, m.odoStart, m.odoEnd, m.purpose, customerName(m.customerId), m.notes,
        ]),
      ]);
    case 'contributions':
      return toCSV([
        ['Date', 'Description', 'Debit account', 'Credit account', 'Amount', 'Source', 'Notes'],
        ...allContributions().map(c => [
          c.date, c.description, c.debitAccount, EQUITY_ACCOUNT, c.amount, c.source === 'expense' ? 'Expense paid personally' : 'Journal entry', c.notes,
        ]),
      ]);
    case 'customers':
      return toCSV([
        ['Name', 'Phone', 'Email', 'Address', 'Vehicles', 'Jobs', 'Lifetime spend', 'Notes'],
        ...d.customers.map(c => {
          const jobs = d.jobs.filter(j => j.customerId === c.id);
          return [
            c.name, c.phone, c.email, c.address, c.vehicles.map(describeVehicle).join('; '),
            jobs.length, jobs.reduce((s, j) => s + jobTotal(j), 0), c.notes,
          ];
        }),
      ]);
    case 'payouts':
      return toCSV([
        ['Date', 'Worker', 'Amount', 'Method', 'Notes'],
        ...[...d.payouts].sort(byDateDesc).map(p => [p.date, workerName(p.workerId), p.amount, p.method, p.notes]),
      ]);
    case 'workers': {
      const year = new Date().getFullYear();
      const yr = { start: `${year}-01-01`, end: `${year}-12-31` };
      const threshold = Number(d.settings.reportThreshold1099) || 0;
      return toCSV([
        ['Name', 'Phone', 'Email', 'Default commission %', 'W-9 on file', 'Active', `Earned ${year}`, `Paid ${year}`, `1099-NEC needed ${year}`, 'Owed now', 'Notes'],
        ...d.workers.map(w => {
          const y = workerEarnings(w.id, yr);
          return [w.name, w.phone, w.email, w.commissionPct, w.w9OnFile ? 'Yes' : 'No', w.active === false ? 'No' : 'Yes',
            y.earned, y.paid, y.paid >= threshold ? 'Yes' : 'No', workerEarnings(w.id).owed, w.notes];
        }),
      ]);
    }
    default:
      throw new Error('Unknown export ' + kind);
  }
}
