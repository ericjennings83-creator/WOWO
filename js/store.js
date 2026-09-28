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
  for (const k of ['customers', 'jobs', 'expenses', 'mileage', 'contributions', 'workers', 'payouts']) {
    if (!Array.isArray(out[k])) out[k] = [];
  }
  for (const c of out.customers) if (!Array.isArray(c.vehicles)) c.vehicles = [];
  for (const j of out.jobs) if (!Array.isArray(j.crew)) j.crew = [];
  return out;
}

let data = load();
const listeners = new Set();

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
    alert('Could not save — your phone storage may be full. Export a backup from Settings.');
    throw e;
  }
  listeners.forEach(fn => fn());
}

export function onChange(fn) { listeners.add(fn); }

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
      debitAccount: accountForExpenseCategory(e.category),
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
        ['Date', 'Miles', 'Start odometer', 'End odometer', 'Purpose', 'Customer', 'Notes'],
        ...[...d.mileage].sort(byDateDesc).map(m => [
          m.date, m.miles, m.odoStart, m.odoEnd, m.purpose, customerName(m.customerId), m.notes,
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
