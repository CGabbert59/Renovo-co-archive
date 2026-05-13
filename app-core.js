'use strict';

// CONFIG
const SUPABASE_URL = 'https://qofwwztuykerlcxfuutv.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_SRrLgFY1zPiplYahG6b5nw_oXKzWkVv';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// PRICING
function calcJobPrice(beds, baths, rush = false, deepClean = false) {
  beds = parseInt(beds) || 1;
  baths = parseInt(baths) || 1;
  let base = 80, bedCharge = 0, bathCharge = 0;
  if (beds >= 4) {
    base = 230;
  } else {
    bedCharge = beds * 30;
    bathCharge = baths * 20;
    base = 80 + bedCharge + bathCharge;
  }
  const rushCharge = rush ? 75 : 0;
  const deepMult = deepClean ? 2 : 1;
  const total = (base + rushCharge) * deepMult;
  return { base: beds >= 4 ? 230 : 80, bedCharge, bathCharge, rushCharge, deepMult, total };
}

const STANDARD_CHECKLIST = [
  { category: 'Living Areas', task: 'Dust all surfaces and furniture', sort_order: 1 },
  { category: 'Living Areas', task: 'Vacuum all floors and rugs', sort_order: 2 },
  { category: 'Living Areas', task: 'Mop hard floors', sort_order: 3 },
  { category: 'Living Areas', task: 'Wipe light switches and outlets', sort_order: 4 },
  { category: 'Living Areas', task: 'Clean windows and glass doors', sort_order: 5 },
  { category: 'Living Areas', task: 'Empty all trash cans', sort_order: 6 },
  { category: 'Kitchen', task: 'Clean and sanitize countertops', sort_order: 1 },
  { category: 'Kitchen', task: 'Clean stovetop and oven exterior', sort_order: 2 },
  { category: 'Kitchen', task: 'Clean and sanitize sink', sort_order: 3 },
  { category: 'Kitchen', task: 'Wipe down all appliances', sort_order: 4 },
  { category: 'Kitchen', task: 'Clean microwave inside and out', sort_order: 5 },
  { category: 'Kitchen', task: 'Empty and wipe out trash can', sort_order: 6 },
  { category: 'Kitchen', task: 'Restock paper towels / dish soap', sort_order: 7 },
  { category: 'Bathrooms', task: 'Scrub and disinfect toilet', sort_order: 1 },
  { category: 'Bathrooms', task: 'Clean and polish sink and countertop', sort_order: 2 },
  { category: 'Bathrooms', task: 'Scrub shower and/or bathtub', sort_order: 3 },
  { category: 'Bathrooms', task: 'Clean mirrors', sort_order: 4 },
  { category: 'Bathrooms', task: 'Mop bathroom floor', sort_order: 5 },
  { category: 'Bathrooms', task: 'Replace toilet paper rolls', sort_order: 6 },
  { category: 'Bathrooms', task: 'Restock toiletries and soap', sort_order: 7 },
  { category: 'Bathrooms', task: 'Empty trash', sort_order: 8 },
  { category: 'Bedrooms', task: 'Dust surfaces and nightstands', sort_order: 1 },
  { category: 'Bedrooms', task: 'Vacuum bedroom floors', sort_order: 2 },
  { category: 'Bedrooms', task: 'Empty trash cans', sort_order: 3 },
  { category: 'Laundry', task: 'Wash all linens and towels', sort_order: 1 },
  { category: 'Laundry', task: 'Dry linens and towels', sort_order: 2 },
  { category: 'Laundry', task: 'Replace linens on all beds', sort_order: 3 },
  { category: 'Laundry', task: 'Fold and place fresh towels', sort_order: 4 },
  { category: 'Final Walkthrough', task: 'Walk through entire property', sort_order: 1 },
  { category: 'Final Walkthrough', task: 'Check all doors and windows locked', sort_order: 2 },
  { category: 'Final Walkthrough', task: 'Take before/after photos', sort_order: 3 },
  { category: 'Final Walkthrough', task: 'Report any damage or issues', sort_order: 4 },
];

// STATE
let _user = null, _profile = null, _section = 'dashboard', _filter = 'all';

// UTILS
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }); }
  catch { return '—'; }
}
function fmtMoney(n) {
  if (n == null || n === '') return '$0.00';
  return '$' + parseFloat(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function fmtTime(t) {
  if (!t) return '—';
  const [h, m] = t.split(':');
  const hr = parseInt(h);
  return `${hr % 12 || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`;
}
function timeAgo(d) {
  if (!d) return '';
  const s = Math.floor((Date.now() - new Date(d)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}
function isAdmin() { return _profile?.role === 'admin'; }

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function statusBadge(s) {
  const map = {
    pending: 'badge-gray', assigned: 'badge-blue', in_progress: 'badge-yellow',
    completed: 'badge-green', cancelled: 'badge-red',
    draft: 'badge-gray', paid: 'badge-green', overdue: 'badge-red',
    active: 'badge-green', inactive: 'badge-gray',
    airbnb: 'badge-gold', vrbo: 'badge-blue', 'booking.com': 'badge-purple', direct: 'badge-gray',
    standard: 'badge-gray', deep: 'badge-blue', rush: 'badge-red', staging: 'badge-purple',
  };
  const cls = map[s] || 'badge-gray';
  return `<span class="badge ${cls}">${esc(s?.replace(/_/g,' ') || '—')}</span>`;
}

// MODAL
function openModal(html) {
  const ov = document.getElementById('modal-overlay');
  document.getElementById('modal-container').innerHTML = html;
  ov.classList.remove('hidden');
}
function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('modal-container').innerHTML = '';
}
function handleOverlayClick(e) {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
}

// AUTH
async function handleLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('login-btn');
  const errEl = document.getElementById('login-err');
  btn.innerHTML = '<span class="spinner"></span>';
  btn.disabled = true;
  errEl.classList.add('hidden');
  const email = document.getElementById('l-email').value.trim();
  const pass = document.getElementById('l-pass').value;
  const { error } = await sb.auth.signInWithPassword({ email, password: pass });
  if (error) {
    errEl.textContent = error.message;
    errEl.classList.remove('hidden');
    btn.textContent = 'Sign In';
    btn.disabled = false;
  }
}

async function handleSignOut() {
  await sb.auth.signOut();
}

// NAVIGATION
const NAV = [
  { id:'dashboard', label:'Dashboard', icon:'📊' },
  { id:'jobs', label:'Jobs', icon:'🧹' },
  { id:'properties', label:'Properties', icon:'🏠' },
  { id:'clients', label:'Clients', icon:'👥' },
  { id:'employees', label:'Employees', icon:'👤' },
  { id:'invoices', label:'Invoices', icon:'📄' },
  { id:'media', label:'Media', icon:'📸' },
  { id:'messages', label:'Messages', icon:'💬' },
  { id:'settings', label:'Settings', icon:'⚙️' },
];

function navigate(section) {
  _section = section;
  _filter = 'all';
  renderNav();
  renderSection();
}

function renderNav() {
  document.getElementById('sidebar-nav').innerHTML = NAV.map(n => `
    <div class="nav-item ${_section === n.id ? 'active' : ''}" onclick="navigate('${n.id}')">
      <span class="nav-icon">${n.icon}</span>
      <span>${n.label}</span>
    </div>
  `).join('');
}

function renderShell() {
  const u = _profile;
  document.getElementById('sidebar-user').innerHTML = `
    <strong>${esc(u?.full_name || _user?.email || 'User')}</strong>
    <span>${esc(u?.role || 'employee')}</span>
  `;
  renderNav();
  renderSection();
}

function renderSection() {
  const mc = document.getElementById('main-content');
  mc.scrollTop = 0;
  const fn = {
    dashboard: renderDashboard,
    jobs: renderJobs,
    properties: renderProperties,
    clients: renderClients,
    employees: renderEmployees,
    invoices: renderInvoices,
    media: renderMedia,
    messages: renderMessages,
    settings: renderSettings,
  }[_section];
  if (fn) fn();
}

// DASHBOARD
async function renderDashboard() {
  const mc = document.getElementById('main-content');
  mc.innerHTML = `
    <div class="page-header"><h1>Dashboard</h1></div>
    <div class="page-body">
      <div class="stats-grid" id="dash-stats">
        ${['','','',''].map(() => `<div class="stat-card"><div class="stat-label">Loading…</div><div class="stat-value">—</div></div>`).join('')}
      </div>
      <div class="two-col">
        <div class="card">
          <div class="card-header"><span class="card-title">Upcoming Jobs</span><a href="#" onclick="navigate('jobs');return false;" class="btn btn-sm btn-secondary">View all</a></div>
          <div id="dash-jobs">Loading…</div>
        </div>
        <div class="card">
          <div class="card-header"><span class="card-title">Recent Activity</span></div>
          <div id="dash-activity">Loading…</div>
        </div>
      </div>
    </div>`;

  const today = new Date().toISOString().split('T')[0];
  const week = new Date(Date.now() + 7*86400000).toISOString().split('T')[0];

  const [jobsToday, upcomingJobs, pendingInv, activity, propCount, totalRev] = await Promise.all([
    sb.from('jobs').select('id', { count:'exact', head:true }).eq('scheduled_date', today).neq('status','cancelled'),
    sb.from('jobs').select('id, scheduled_date, scheduled_time, job_type, status, total_price, properties(name)').gte('scheduled_date', today).lte('scheduled_date', week).neq('status','cancelled').order('scheduled_date').limit(5),
    sb.from('invoices').select('id, amount').eq('status','pending'),
    sb.from('activity_log').select('description, type, created_at').order('created_at', { ascending:false }).limit(10),
    sb.from('properties').select('id', { count:'exact', head:true }).eq('status','active'),
    sb.from('invoices').select('amount').eq('status','paid').gte('created_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()),
  ]);

  const pendingTotal = (pendingInv.data || []).reduce((s, i) => s + parseFloat(i.amount || 0), 0);
  const monthRev = (totalRev.data || []).reduce((s, i) => s + parseFloat(i.amount || 0), 0);

  document.getElementById('dash-stats').innerHTML = `
    <div class="stat-card"><div class="stat-label">Jobs Today</div><div class="stat-value">${jobsToday.count || 0}</div><div class="stat-sub">scheduled</div></div>
    <div class="stat-card"><div class="stat-label">Pending Invoices</div><div class="stat-value">${(pendingInv.data || []).length}</div><div class="stat-sub">${fmtMoney(pendingTotal)} outstanding</div></div>
    <div class="stat-card"><div class="stat-label">Active Properties</div><div class="stat-value">${propCount.count || 0}</div><div class="stat-sub">on platform</div></div>
    <div class="stat-card"><div class="stat-label">Revenue This Month</div><div class="stat-value">${fmtMoney(monthRev)}</div><div class="stat-sub">paid invoices</div></div>
  `;

  const jobs = upcomingJobs.data || [];
  document.getElementById('dash-jobs').innerHTML = jobs.length ? jobs.map(j => `
    <div class="activity-item">
      <div class="activity-dot" style="background:var(--green)"></div>
      <div>
        <div class="activity-text"><strong>${esc(j.properties?.name || 'Property')}</strong> — ${esc(j.job_type)} clean</div>
        <div class="activity-time">${fmtDate(j.scheduled_date)} ${fmtTime(j.scheduled_time)} · ${fmtMoney(j.total_price)} · ${statusBadge(j.status)}</div>
      </div>
    </div>`).join('')
    : '<div class="empty-state" style="padding:30px"><p>No upcoming jobs this week</p></div>';

  const acts = activity.data || [];
  document.getElementById('dash-activity').innerHTML = acts.length ? `<div class="activity-list">${acts.map(a => `
    <div class="activity-item">
      <div class="activity-dot"></div>
      <div>
        <div class="activity-text">${esc(a.description)}</div>
        <div class="activity-time">${timeAgo(a.created_at)}</div>
      </div>
    </div>`).join('')}</div>`
    : '<div class="empty-state" style="padding:30px"><p>No recent activity</p></div>';
}

// JOBS
async function renderJobs() {
  const mc = document.getElementById('main-content');
  mc.innerHTML = `
    <div class="page-header">
      <h1>Jobs</h1>
      ${isAdmin() ? `<button class="btn btn-primary" onclick="showJobModal()">+ New Job</button>` : ''}
    </div>
    <div class="page-body">
      <div class="filter-tabs">
        ${['all','pending','assigned','in_progress','completed','cancelled'].map(f => `
          <div class="filter-tab ${_filter===f?'active':''}" onclick="setFilter('${f}')">${f.replace(/_/g,' ')}</div>`).join('')}
      </div>
      <div class="card">
        <div class="table-wrap" id="jobs-table">Loading…</div>
      </div>
    </div>`;
  await loadJobsTable();
}

async function loadJobsTable() {
  let q = sb.from('jobs')
    .select('*, properties(name, bedrooms, bathrooms, client_id), job_assignments(id, employee_id, employees(first_name, last_name))')
    .order('scheduled_date', { ascending: false });
  if (_filter !== 'all') q = q.eq('status', _filter);
  const { data, error } = await q.limit(100);
  if (error) { document.getElementById('jobs-table').innerHTML = `<p class="text-muted" style="padding:20px">Error: ${esc(error.message)}</p>`; return; }
  const jobs = data || [];
  if (!jobs.length) {
    document.getElementById('jobs-table').innerHTML = `<div class="empty-state"><div class="icon">🧹</div><p>No jobs found</p><div class="sub">Create a job or connect booking platforms</div></div>`;
    return;
  }
  document.getElementById('jobs-table').innerHTML = `
    <table>
      <thead><tr>
        <th>Property</th><th>Date</th><th>Time</th><th>Type</th><th>Status</th><th>Price</th><th>Assigned</th><th>Actions</th>
      </tr></thead>
      <tbody>${jobs.map(j => {
        const assigned = (j.job_assignments || []).map(a => `${a.employees?.first_name || ''} ${a.employees?.last_name || ''}`.trim()).filter(Boolean).join(', ') || '—';
        return `<tr>
          <td><strong>${esc(j.properties?.name || 'Unknown')}</strong>${j.auto_generated ? ' <span class="tag">auto</span>' : ''}</td>
          <td>${fmtDate(j.scheduled_date)}</td>
          <td>${fmtTime(j.scheduled_time)}</td>
          <td>${statusBadge(j.job_type)}</td>
          <td>${statusBadge(j.status)}</td>
          <td>${fmtMoney(j.total_price)}</td>
          <td class="text-muted text-sm">${esc(assigned)}</td>
          <td class="td-actions">
            <button class="btn btn-sm btn-secondary" onclick="showJobDetail('${j.id}')">View</button>
            ${isAdmin() ? `<button class="btn btn-sm btn-secondary" onclick="showJobModal('${j.id}')">Edit</button>` : ''}
          </td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
}

function setFilter(f) {
  _filter = f;
  document.querySelectorAll('.filter-tab').forEach(el => el.classList.toggle('active', el.textContent.trim() === f.replace(/_/g,' ')));
  loadJobsTable();
}

async function showJobModal(id = null) {
  const [propRes, empRes] = await Promise.all([
    sb.from('properties').select('id, name, bedrooms, bathrooms').eq('status','active').order('name'),
    sb.from('employees').select('id, first_name, last_name').eq('status','active').order('first_name'),
  ]);
  const props = propRes.data || [];
  let job = null;
  if (id) { const { data } = await sb.from('jobs').select('*').eq('id', id).single(); job = data; }
  openModal(`
    <div class="modal modal-lg">
      <div class="modal-header">
        <h3>${id ? 'Edit Job' : 'New Job'}</h3>
        <button class="modal-close" onclick="closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <form id="job-form" onsubmit="saveJob(event,'${id||''}')">
          <div class="form-grid">
            <div class="form-group form-full">
              <label>Property *</label>
              <select id="jf-prop" required onchange="updateJobPrice()">
                <option value="">Select property…</option>
                ${props.map(p => `<option value="${p.id}" data-beds="${p.bedrooms||1}" data-baths="${p.bathrooms||1}" ${job?.property_id===p.id?'selected':''}>${esc(p.name)} (${p.bedrooms||1}bd/${p.bathrooms||1}ba)</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Job Type</label>
              <select id="jf-type">
                <option value="standard" ${job?.job_type==='standard'||!job?'selected':''}>Standard Clean</option>
                <option value="deep" ${job?.job_type==='deep'?'selected':''}>Deep Clean</option>
                <option value="rush" ${job?.job_type==='rush'?'selected':''}>Rush Clean</option>
                <option value="staging" ${job?.job_type==='staging'?'selected':''}>Staging</option>
              </select>
            </div>
            <div class="form-group">
              <label>Status</label>
              <select id="jf-status">
                ${['pending','assigned','in_progress','completed','cancelled'].map(s => `<option value="${s}" ${job?.status===s||(s==='pending'&&!job)?'selected':''}>${s.replace(/_/g,' ')}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Scheduled Date</label>
              <input type="date" id="jf-date" value="${job?.scheduled_date||''}" required/>
            </div>
            <div class="form-group">
              <label>Scheduled Time</label>
              <input type="time" id="jf-time" value="${job?.scheduled_time?.slice(0,5)||'10:00'}"/>
            </div>
            <div class="form-group">
              <label>Rush Charge</label>
              <select id="jf-rush" onchange="updateJobPrice()">
                <option value="0" ${!job?.rush_charge||job?.rush_charge==0?'selected':''}>None</option>
                <option value="75" ${job?.rush_charge==75?'selected':''}>+$75 Rush</option>
                <option value="100" ${job?.rush_charge==100?'selected':''}>+$100 Rush</option>
              </select>
            </div>
            <div class="form-group">
              <label>Deep Clean</label>
              <select id="jf-deep" onchange="updateJobPrice()">
                <option value="1" ${!job?.deep_clean_multiplier||job?.deep_clean_multiplier<=1?'selected':''}>No</option>
                <option value="2" ${job?.deep_clean_multiplier>=2?'selected':''}>Yes (2× price)</option>
              </select>
            </div>
          </div>
          <div class="price-breakdown mb-16" id="jf-price-preview" style="margin-top:16px">
            <div class="price-row"><span>Select a property to see pricing</span></div>
          </div>
          <div class="form-group">
            <label>Notes</label>
            <textarea id="jf-notes">${esc(job?.notes||'')}</textarea>
          </div>
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="document.getElementById('job-form').requestSubmit()">${id ? 'Save Changes' : 'Create Job'}</button>
      </div>
    </div>`);
  if (job) updateJobPrice();
}

function updateJobPrice() {
  const sel = document.getElementById('jf-prop');
  const opt = sel?.options[sel.selectedIndex];
  if (!opt || !opt.value) return;
  const beds = parseInt(opt.dataset.beds) || 1;
  const baths = parseInt(opt.dataset.baths) || 1;
  const rush = parseInt(document.getElementById('jf-rush')?.value || 0);
  const deep = parseFloat(document.getElementById('jf-deep')?.value || 1);
  const p = calcJobPrice(beds, baths, rush > 0, deep > 1);
  const preview = document.getElementById('jf-price-preview');
  if (!preview) return;
  const base4 = beds >= 4;
  preview.innerHTML = `
    ${base4 ? `<div class="price-row"><span>4+ Bedroom flat rate</span><span>${fmtMoney(230)}</span></div>`
      : `<div class="price-row"><span>Base</span><span>${fmtMoney(80)}</span></div>
         <div class="price-row"><span>${beds} Bedroom${beds!==1?'s':''} (×$30)</span><span>+${fmtMoney(p.bedCharge)}</span></div>
         <div class="price-row"><span>${baths} Bathroom${baths!==1?'s':''} (×$20)</span><span>+${fmtMoney(p.bathCharge)}</span></div>`}
    ${p.rushCharge > 0 ? `<div class="price-row"><span>Rush charge</span><span>+${fmtMoney(p.rushCharge)}</span></div>` : ''}
    ${deep > 1 ? `<div class="price-row"><span>Deep clean (×2)</span><span></span></div>` : ''}
    <div class="price-row total"><span>Total</span><span>${fmtMoney(p.total)}</span></div>`;
}

async function saveJob(e, id) {
  e.preventDefault();
  const sel = document.getElementById('jf-prop');
  const opt = sel?.options[sel.selectedIndex];
  const beds = parseInt(opt?.dataset.beds) || 1;
  const baths = parseInt(opt?.dataset.baths) || 1;
  const rush = parseInt(document.getElementById('jf-rush').value) || 0;
  const deep = parseFloat(document.getElementById('jf-deep').value) || 1;
  const p = calcJobPrice(beds, baths, rush > 0, deep > 1);
  const status = document.getElementById('jf-status').value;
  const payload = {
    property_id: sel.value,
    job_type: document.getElementById('jf-type').value,
    status,
    scheduled_date: document.getElementById('jf-date').value,
    scheduled_time: document.getElementById('jf-time').value + ':00',
    base_price: p.base,
    bedroom_charge: p.bedCharge,
    bathroom_charge: p.bathCharge,
    rush_charge: rush,
    deep_clean_multiplier: deep,
    total_price: p.total,
    notes: document.getElementById('jf-notes').value.trim() || null,
    updated_at: new Date().toISOString(),
  };
  let jobId = id;
  if (id) {
    const { error } = await sb.from('jobs').update(payload).eq('id', id);
    if (error) { toast(error.message, 'error'); return; }
  } else {
    const { data, error } = await sb.from('jobs').insert({ ...payload, auto_generated: false, created_at: new Date().toISOString() }).select().single();
    if (error) { toast(error.message, 'error'); return; }
    jobId = data.id;
    await createChecklist(jobId);
    await logActivity(`Job created for ${opt?.text?.split(' (')[0] || 'property'} on ${payload.scheduled_date}`);
  }
  if (status === 'completed') await autoCreateInvoice(jobId);
  closeModal();
  toast(id ? 'Job updated' : 'Job created');
  loadJobsTable();
}

async function createChecklist(jobId) {
  const { data: cl } = await sb.from('checklists').insert({ job_id: jobId, status: 'pending', created_at: new Date().toISOString() }).select().single();
  if (cl) {
    const items = STANDARD_CHECKLIST.map(item => ({ checklist_id: cl.id, category: item.category, task: item.task, sort_order: item.sort_order, completed: false, created_at: new Date().toISOString() }));
    await sb.from('checklist_items').insert(items);
  }
}

async function autoCreateInvoice(jobId) {
  const { data: existing } = await sb.from('invoices').select('id').eq('job_id', jobId).maybeSingle();
  if (existing) return;
  const { data: job } = await sb.from('jobs').select('*, properties(name, client_id)').eq('id', jobId).single();
  if (!job) return;
  const { count } = await sb.from('invoices').select('*', { count:'exact', head:true });
  const num = `INV-${String((count || 0) + 1).padStart(4, '0')}`;
  const due = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
  await sb.from('invoices').insert({
    job_id: jobId,
    client_id: job.properties?.client_id || null,
    invoice_number: num,
    amount: job.total_price,
    status: 'pending',
    due_date: due,
    notes: `Auto-generated — ${job.properties?.name || 'Job'} (${fmtDate(job.scheduled_date)})`,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  await logActivity(`Invoice ${num} auto-created for completed job at ${job.properties?.name || 'property'}`);
}

async function showJobDetail(jobId) {
  const { data: job } = await sb.from('jobs')
    .select('*, properties(name, address, city, state, bedrooms, bathrooms, access_notes, client_id, clients(first_name, last_name, email)), job_assignments(id, employee_id, status, employees(first_name, last_name))')
    .eq('id', jobId).single();
  if (!job) return;
  const { data: cl } = await sb.from('checklists').select('*, checklist_items(*)').eq('job_id', jobId).maybeSingle();
  const { data: empList } = await sb.from('employees').select('id, first_name, last_name').eq('status','active').order('first_name');
  const items = cl?.checklist_items || [];
  const done = items.filter(i => i.completed).length;
  const pct = items.length ? Math.round(done/items.length*100) : 0;
  const categories = [...new Set(STANDARD_CHECKLIST.map(i => i.category))];
  const clientName = job.properties?.clients ? `${job.properties.clients.first_name} ${job.properties.clients.last_name}` : '—';
  const assigned = (job.job_assignments || []).map(a => a.employee_id);
  openModal(`
    <div class="modal modal-xl">
      <div class="modal-header">
        <h3>Job — ${esc(job.properties?.name || 'Job')}</h3>
        <button class="modal-close" onclick="closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="two-col mb-16">
          <div>
            <div class="section-title">Details</div>
            <div class="job-detail-grid">
              <div class="detail-row"><span class="detail-label">Date</span><span class="detail-value">${fmtDate(job.scheduled_date)}</span></div>
              <div class="detail-row"><span class="detail-label">Time</span><span class="detail-value">${fmtTime(job.scheduled_time)}</span></div>
              <div class="detail-row"><span class="detail-label">Type</span><span class="detail-value">${statusBadge(job.job_type)}</span></div>
              <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value">${statusBadge(job.status)}</span></div>
              <div class="detail-row"><span class="detail-label">Client</span><span class="detail-value">${esc(clientName)}</span></div>
              <div class="detail-row"><span class="detail-label">Property</span><span class="detail-value">${esc(job.properties?.address || '—')}, ${esc(job.properties?.city || '')}</span></div>
            </div>
            ${job.properties?.access_notes ? `<div class="info-box" style="margin-top:12px"><strong>🔑 Access Notes:</strong><br>${esc(job.properties.access_notes)}</div>` : ''}
            <div class="price-breakdown" style="margin-top:12px">
              ${job.bedroom_charge > 0 ? `<div class="price-row"><span>Base</span><span>${fmtMoney(job.base_price)}</span></div><div class="price-row"><span>Bedrooms</span><span>+${fmtMoney(job.bedroom_charge)}</span></div><div class="price-row"><span>Bathrooms</span><span>+${fmtMoney(job.bathroom_charge)}</span></div>` : `<div class="price-row"><span>4+ Bedroom flat rate</span><span>${fmtMoney(job.base_price)}</span></div>`}
              ${job.rush_charge > 0 ? `<div class="price-row"><span>Rush</span><span>+${fmtMoney(job.rush_charge)}</span></div>` : ''}
              ${job.deep_clean_multiplier > 1 ? `<div class="price-row"><span>Deep clean ×${job.deep_clean_multiplier}</span><span></span></div>` : ''}
              <div class="price-row total"><span>Total</span><span>${fmtMoney(job.total_price)}</span></div>
            </div>
          </div>
          <div>
            <div class="section-title">Assign Employees</div>
            <div style="display:flex;flex-direction:column;gap:8px;max-height:160px;overflow-y:auto">
              ${(empList||[]).map(emp => `
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:6px;border-radius:6px;background:var(--bg)">
                  <input type="checkbox" id="assign-${emp.id}" ${assigned.includes(emp.id)?'checked':''} onchange="toggleAssignment('${jobId}','${emp.id}',this.checked)" style="width:16px;height:16px;accent-color:var(--green)"/>
                  ${esc(emp.first_name)} ${esc(emp.last_name)}
                </label>`).join('')}
            </div>
            ${isAdmin() && job.status !== 'completed' && job.status !== 'cancelled' ? `
            <div style="margin-top:16px;display:flex;flex-direction:column;gap:8px">
              <button class="btn btn-primary btn-full" onclick="markJobComplete('${jobId}')">✓ Mark Complete + Create Invoice</button>
              <button class="btn btn-secondary btn-full" onclick="updateJobStatus('${jobId}','cancelled')">Cancel Job</button>
            </div>` : ''}
            ${job.notes ? `<div class="info-box warning" style="margin-top:12px"><strong>Notes:</strong><br>${esc(job.notes)}</div>` : ''}
          </div>
        </div>
        <div class="divider"></div>
        <div class="section-title">Checklist ${items.length ? `(${done}/${items.length} — ${pct}%)` : ''}</div>
        ${items.length ? `<div class="checklist-progress"><div class="checklist-progress-bar" style="width:${pct}%"></div></div>` : ''}
        <div id="checklist-body">
          ${cl ? renderChecklistHTML(items, categories) : `<div class="info-box">No checklist yet. <a href="#" onclick="createAndLoadChecklist('${jobId}');return false">Create standard checklist</a></div>`}
        </div>
      </div>
    </div>`);
}

function renderChecklistHTML(items, categories) {
  return categories.map(cat => {
    const catItems = items.filter(i => i.category === cat).sort((a,b) => a.sort_order - b.sort_order);
    if (!catItems.length) return '';
    return `<div class="checklist-category">
      <h4>${esc(cat)}</h4>
      ${catItems.map(item => `
        <label class="checklist-item ${item.completed ? 'done' : ''}">
          <input type="checkbox" ${item.completed ? 'checked' : ''} onchange="toggleCheckItem('${item.id}', this.checked)"/>
          <span>${esc(item.task)}</span>
        </label>`).join('')}
    </div>`;
  }).join('');
}

async function createAndLoadChecklist(jobId) {
  await createChecklist(jobId);
  showJobDetail(jobId);
}

async function toggleCheckItem(itemId, completed) {
  await sb.from('checklist_items').update({ completed, completed_at: completed ? new Date().toISOString() : null }).eq('id', itemId);
}

async function toggleAssignment(jobId, empId, checked) {
  if (checked) {
    await sb.from('job_assignments').insert({ job_id: jobId, employee_id: empId, status: 'assigned', created_at: new Date().toISOString() });
    const { data: e } = await sb.from('employees').select('first_name, last_name').eq('id', empId).single();
    if (e) await logActivity(`${e.first_name} ${e.last_name} assigned to job`);
  } else {
    await sb.from('job_assignments').delete().eq('job_id', jobId).eq('employee_id', empId);
  }
}

async function markJobComplete(jobId) {
  await updateJobStatus(jobId, 'completed');
  await autoCreateInvoice(jobId);
  closeModal();
  toast('Job completed and invoice created');
  loadJobsTable();
}

async function updateJobStatus(jobId, status) {
  await sb.from('jobs').update({ status, updated_at: new Date().toISOString() }).eq('id', jobId);
  if (status === 'cancelled') { closeModal(); toast('Job cancelled'); loadJobsTable(); }
  await logActivity(`Job marked ${status}`);
}

async function logActivity(desc, type = 'job') {
  await sb.from('activity_log').insert({ description: desc, type, user_id: _user?.id || null, created_at: new Date().toISOString() });
}
