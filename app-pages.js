// PROPERTIES
async function renderProperties() {
  const mc = document.getElementById('main-content');
  mc.innerHTML = `
    <div class="page-header">
      <h1>Properties</h1>
      ${isAdmin() ? `<button class="btn btn-primary" onclick="showPropertyModal()">+ Add Property</button>` : ''}
    </div>
    <div class="page-body">
      <div class="card"><div class="table-wrap" id="props-table">Loading…</div></div>
    </div>`;
  const [propsRes, jobCountRes] = await Promise.all([
    sb.from('properties').select('*, clients(first_name, last_name)').order('name'),
    sb.from('jobs').select('property_id').neq('status','cancelled'),
  ]);
  if (propsRes.error) { document.getElementById('props-table').innerHTML = `<p class="text-muted" style="padding:20px">${esc(propsRes.error.message)}</p>`; return; }
  const props = propsRes.data || [];
  // Build job count map
  const jobCounts = {};
  (jobCountRes.data || []).forEach(j => { jobCounts[j.property_id] = (jobCounts[j.property_id] || 0) + 1; });
  if (!props.length) { document.getElementById('props-table').innerHTML = `<div class="empty-state"><div class="icon">🏠</div><p>No properties yet</p></div>`; return; }
  document.getElementById('props-table').innerHTML = `
    <table>
      <thead><tr><th>Name</th><th>Address</th><th>Bed/Bath</th><th>Platform</th><th>Client</th><th>Jobs</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${props.map(p => `<tr>
        <td><strong>${esc(p.name)}</strong></td>
        <td class="text-sm text-muted">${esc(p.address || '—')}, ${esc(p.city || '')}</td>
        <td>${p.bedrooms||1}bd / ${p.bathrooms||1}ba</td>
        <td>${statusBadge(p.platform)}</td>
        <td class="text-sm">${p.clients ? esc(`${p.clients.first_name} ${p.clients.last_name}`) : '—'}</td>
        <td class="text-sm">${jobCounts[p.id] || 0}</td>
        <td>${statusBadge(p.status)}</td>
        <td class="td-actions">
          ${isAdmin() ? `<button class="btn btn-sm btn-secondary" onclick="showPropertyModal('${p.id}')">Edit</button>
          <button class="btn btn-sm btn-danger" onclick="deleteProperty('${p.id}')">Del</button>` : ''}
        </td>
      </tr>`).join('')}</tbody>
    </table>`;
}

async function showPropertyModal(id = null) {
  const { data: clients } = await sb.from('clients').select('id, first_name, last_name').eq('status','active').order('last_name');
  let p = null;
  if (id) { const { data } = await sb.from('properties').select('*').eq('id', id).single(); p = data; }
  openModal(`
    <div class="modal modal-lg">
      <div class="modal-header">
        <h3>${id ? 'Edit Property' : 'New Property'}</h3>
        <button class="modal-close" onclick="closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <form id="prop-form" onsubmit="saveProperty(event,'${id||''}')">
          <div class="form-grid">
            <div class="form-group form-full"><label>Property Name *</label><input id="pf-name" value="${esc(p?.name||'')}" required/></div>
            <div class="form-group form-full"><label>Address</label><input id="pf-addr" value="${esc(p?.address||'')}"/></div>
            <div class="form-group"><label>City</label><input id="pf-city" value="${esc(p?.city||'Abilene')}"/></div>
            <div class="form-group"><label>State</label><input id="pf-state" value="${esc(p?.state||'TX')}"/></div>
            <div class="form-group"><label>Bedrooms</label><input type="number" id="pf-beds" min="1" max="20" value="${p?.bedrooms||1}"/></div>
            <div class="form-group"><label>Bathrooms</label><input type="number" id="pf-baths" min="1" max="20" value="${p?.bathrooms||1}"/></div>
            <div class="form-group"><label>Platform</label>
              <select id="pf-platform">
                ${['airbnb','vrbo','booking.com','direct'].map(pl => `<option value="${pl}" ${p?.platform===pl?'selected':''}>${pl}</option>`).join('')}
              </select>
            </div>
            <div class="form-group"><label>Base Rate ($)</label><input type="number" id="pf-rate" value="${p?.base_rate||80}" step="0.01"/></div>
            <div class="form-group"><label>Client</label>
              <select id="pf-client">
                <option value="">None</option>
                ${(clients||[]).map(c => `<option value="${c.id}" ${p?.client_id===c.id?'selected':''}>${esc(c.first_name)} ${esc(c.last_name)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group"><label>Status</label>
              <select id="pf-status">
                <option value="active" ${p?.status==='active'||!p?'selected':''}>Active</option>
                <option value="inactive" ${p?.status==='inactive'?'selected':''}>Inactive</option>
              </select>
            </div>
            <div class="form-group form-full"><label>🔑 Access Notes (door codes, lockbox, parking)</label><textarea id="pf-access">${esc(p?.access_notes||'')}</textarea></div>
            <div class="form-group form-full"><label>Notes</label><textarea id="pf-notes">${esc(p?.notes||'')}</textarea></div>
          </div>
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="document.getElementById('prop-form').requestSubmit()">${id ? 'Save' : 'Create Property'}</button>
      </div>
    </div>`);
}

async function saveProperty(e, id) {
  e.preventDefault();
  const payload = {
    name: document.getElementById('pf-name').value.trim(),
    address: document.getElementById('pf-addr').value.trim() || null,
    city: document.getElementById('pf-city').value.trim() || 'Abilene',
    state: document.getElementById('pf-state').value.trim() || 'TX',
    bedrooms: parseInt(document.getElementById('pf-beds').value) || 1,
    bathrooms: parseInt(document.getElementById('pf-baths').value) || 1,
    platform: document.getElementById('pf-platform').value,
    base_rate: parseFloat(document.getElementById('pf-rate').value) || 80,
    client_id: document.getElementById('pf-client').value || null,
    status: document.getElementById('pf-status').value,
    access_notes: document.getElementById('pf-access').value.trim() || null,
    notes: document.getElementById('pf-notes').value.trim() || null,
    updated_at: new Date().toISOString(),
  };
  if (id) {
    const { error } = await sb.from('properties').update(payload).eq('id', id);
    if (error) { toast(error.message, 'error'); return; }
  } else {
    const { error } = await sb.from('properties').insert({ ...payload, created_at: new Date().toISOString() });
    if (error) { toast(error.message, 'error'); return; }
  }
  closeModal(); toast(id ? 'Property updated' : 'Property created'); renderProperties();
}

async function deleteProperty(id) {
  if (!confirm('Delete this property? This cannot be undone.')) return;
  const { error } = await sb.from('properties').delete().eq('id', id);
  if (error) { toast(error.message, 'error'); return; }
  toast('Property deleted'); renderProperties();
}

// CLIENTS
async function renderClients() {
  const mc = document.getElementById('main-content');
  mc.innerHTML = `
    <div class="page-header">
      <h1>Clients</h1>
      ${isAdmin() ? `<button class="btn btn-primary" onclick="showClientModal()">+ Add Client</button>` : ''}
    </div>
    <div class="page-body">
      <div class="card"><div class="table-wrap" id="clients-table">Loading…</div></div>
    </div>`;
  const { data, error } = await sb.from('clients').select('*').order('last_name');
  const clients = data || [];
  if (error || !clients.length) {
    document.getElementById('clients-table').innerHTML = clients.length === 0 ? `<div class="empty-state"><div class="icon">👥</div><p>No clients yet</p></div>` : `<p class="text-muted" style="padding:20px">${esc(error?.message)}</p>`;
    return;
  }
  document.getElementById('clients-table').innerHTML = `
    <table>
      <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Status</th><th>QB</th><th>Actions</th></tr></thead>
      <tbody>${clients.map(c => `<tr>
        <td><strong>${esc(c.first_name)} ${esc(c.last_name)}</strong></td>
        <td class="text-sm">${esc(c.email||'—')}</td>
        <td class="text-sm">${esc(c.phone||'—')}</td>
        <td>${statusBadge(c.status)}</td>
        <td class="text-sm">${c.quickbooks_customer_id ? `<span class="badge badge-green">Synced</span>` : '—'}</td>
        <td class="td-actions">
          ${isAdmin() ? `<button class="btn btn-sm btn-secondary" onclick="showClientModal('${c.id}')">Edit</button>
          <button class="btn btn-sm btn-danger" onclick="deleteClient('${c.id}')">Del</button>` : ''}
        </td>
      </tr>`).join('')}</tbody>
    </table>`;
}

async function showClientModal(id = null) {
  let c = null;
  if (id) { const { data } = await sb.from('clients').select('*').eq('id', id).single(); c = data; }
  openModal(`
    <div class="modal">
      <div class="modal-header"><h3>${id ? 'Edit Client' : 'New Client'}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
      <div class="modal-body">
        <form id="client-form" onsubmit="saveClient(event,'${id||''}')">
          <div class="form-grid">
            <div class="form-group"><label>First Name *</label><input id="cf-first" value="${esc(c?.first_name||'')}" required/></div>
            <div class="form-group"><label>Last Name *</label><input id="cf-last" value="${esc(c?.last_name||'')}" required/></div>
            <div class="form-group"><label>Email</label><input type="email" id="cf-email" value="${esc(c?.email||'')}"/></div>
            <div class="form-group"><label>Phone</label><input type="tel" id="cf-phone" value="${esc(c?.phone||'')}"/></div>
            <div class="form-group"><label>Status</label>
              <select id="cf-status"><option value="active" ${c?.status==='active'||!c?'selected':''}>Active</option><option value="inactive" ${c?.status==='inactive'?'selected':''}>Inactive</option></select>
            </div>
            <div class="form-group form-full"><label>Notes</label><textarea id="cf-notes">${esc(c?.notes||'')}</textarea></div>
          </div>
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="document.getElementById('client-form').requestSubmit()">${id ? 'Save' : 'Create Client'}</button>
      </div>
    </div>`);
}

async function saveClient(e, id) {
  e.preventDefault();
  const payload = {
    first_name: document.getElementById('cf-first').value.trim(),
    last_name: document.getElementById('cf-last').value.trim(),
    email: document.getElementById('cf-email').value.trim() || null,
    phone: document.getElementById('cf-phone').value.trim() || null,
    status: document.getElementById('cf-status').value,
    notes: document.getElementById('cf-notes').value.trim() || null,
    updated_at: new Date().toISOString(),
  };
  if (id) { const { error } = await sb.from('clients').update(payload).eq('id', id); if (error) { toast(error.message,'error'); return; } }
  else { const { error } = await sb.from('clients').insert({ ...payload, created_at: new Date().toISOString() }); if (error) { toast(error.message,'error'); return; } }
  closeModal(); toast(id ? 'Client updated' : 'Client created'); renderClients();
}

async function deleteClient(id) {
  if (!confirm('Delete this client?')) return;
  const { error } = await sb.from('clients').delete().eq('id', id);
  if (error) { toast(error.message,'error'); return; }
  toast('Client deleted'); renderClients();
}

// EMPLOYEES
async function renderEmployees() {
  const mc = document.getElementById('main-content');
  mc.innerHTML = `
    <div class="page-header">
      <h1>Employees</h1>
      ${isAdmin() ? `<button class="btn btn-primary" onclick="showEmployeeModal()">+ Add Employee</button>` : ''}
    </div>
    <div class="page-body">
      <div class="card"><div class="table-wrap" id="emp-table">Loading…</div></div>
    </div>`;
  const { data } = await sb.from('employees').select('*').order('last_name');
  const emps = data || [];
  if (!emps.length) { document.getElementById('emp-table').innerHTML = `<div class="empty-state"><div class="icon">👤</div><p>No employees yet</p></div>`; return; }
  document.getElementById('emp-table').innerHTML = `
    <table>
      <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Pay Rate</th><th>Jobs Done</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${emps.map(emp => `<tr>
        <td><strong>${esc(emp.first_name)} ${esc(emp.last_name||'')}</strong></td>
        <td class="text-sm">${esc(emp.email||'—')}</td>
        <td class="text-sm">${esc(emp.phone||'—')}</td>
        <td>${fmtMoney(emp.pay_rate)}/hr</td>
        <td>${emp.jobs_completed||0}</td>
        <td>${statusBadge(emp.status)}</td>
        <td class="td-actions">
          ${isAdmin() ? `<button class="btn btn-sm btn-secondary" onclick="showEmployeeModal('${emp.id}')">Edit</button>
          <button class="btn btn-sm btn-danger" onclick="deleteEmployee('${emp.id}')">Del</button>` : ''}
        </td>
      </tr>`).join('')}</tbody>
    </table>`;
}

async function showEmployeeModal(id = null) {
  let emp = null;
  if (id) { const { data } = await sb.from('employees').select('*').eq('id', id).single(); emp = data; }
  openModal(`
    <div class="modal">
      <div class="modal-header"><h3>${id ? 'Edit Employee' : 'New Employee'}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
      <div class="modal-body">
        <form id="emp-form" onsubmit="saveEmployee(event,'${id||''}')">
          <div class="form-grid">
            <div class="form-group"><label>First Name *</label><input id="ef-first" value="${esc(emp?.first_name||'')}" required/></div>
            <div class="form-group"><label>Last Name</label><input id="ef-last" value="${esc(emp?.last_name||'')}"/></div>
            <div class="form-group"><label>Email</label><input type="email" id="ef-email" value="${esc(emp?.email||'')}"/></div>
            <div class="form-group"><label>Phone</label><input type="tel" id="ef-phone" value="${esc(emp?.phone||'')}"/></div>
            <div class="form-group"><label>Pay Rate ($/hr)</label><input type="number" id="ef-pay" value="${emp?.pay_rate||15}" step="0.50" min="0"/></div>
            <div class="form-group"><label>Status</label>
              <select id="ef-status"><option value="active" ${emp?.status==='active'||!emp?'selected':''}>Active</option><option value="inactive" ${emp?.status==='inactive'?'selected':''}>Inactive</option></select>
            </div>
          </div>
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="document.getElementById('emp-form').requestSubmit()">${id ? 'Save' : 'Add Employee'}</button>
      </div>
    </div>`);
}

async function saveEmployee(e, id) {
  e.preventDefault();
  const payload = {
    first_name: document.getElementById('ef-first').value.trim(),
    last_name: document.getElementById('ef-last').value.trim() || null,
    email: document.getElementById('ef-email').value.trim() || null,
    phone: document.getElementById('ef-phone').value.trim() || null,
    pay_rate: parseFloat(document.getElementById('ef-pay').value) || 15,
    status: document.getElementById('ef-status').value,
    updated_at: new Date().toISOString(),
  };
  if (id) { const { error } = await sb.from('employees').update(payload).eq('id', id); if (error) { toast(error.message,'error'); return; } }
  else { const { error } = await sb.from('employees').insert({ ...payload, created_at: new Date().toISOString() }); if (error) { toast(error.message,'error'); return; } }
  closeModal(); toast(id ? 'Employee updated' : 'Employee added'); renderEmployees();
}

async function deleteEmployee(id) {
  if (!confirm('Delete this employee?')) return;
  const { error } = await sb.from('employees').delete().eq('id', id);
  if (error) { toast(error.message,'error'); return; }
  toast('Employee deleted'); renderEmployees();
}

// INVOICES
async function renderInvoices() {
  const mc = document.getElementById('main-content');
  mc.innerHTML = `
    <div class="page-header">
      <h1>Invoices</h1>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-secondary" onclick="exportInvoicesCSV()">⬇ Export CSV</button>
        ${isAdmin() ? `<button class="btn btn-secondary" onclick="checkQBPayments()">⇄ Sync QB Payments</button>` : ''}
        ${isAdmin() ? `<button class="btn btn-primary" onclick="showInvoiceModal()">+ New Invoice</button>` : ''}
      </div>
    </div>
    <div class="page-body">
      <div class="filter-tabs">
        ${['all','pending','paid','overdue','draft'].map(f => `<div class="filter-tab ${_filter===f?'active':''}" onclick="setInvFilter('${f}')">${f}</div>`).join('')}
      </div>
      <div class="card"><div class="table-wrap" id="inv-table">Loading…</div></div>
    </div>`;
  await loadInvTable();
}

async function loadInvTable() {
  let q = sb.from('invoices').select('*, jobs(job_type, scheduled_date, properties(name)), clients(first_name, last_name)').order('created_at', { ascending: false });
  if (_filter !== 'all') q = q.eq('status', _filter);
  const { data } = await q.limit(100);
  const invs = data || [];
  if (!invs.length) { document.getElementById('inv-table').innerHTML = `<div class="empty-state"><div class="icon">📄</div><p>No invoices</p></div>`; return; }
  document.getElementById('inv-table').innerHTML = `
    <table>
      <thead><tr><th>Invoice #</th><th>Client</th><th>Property</th><th>Amount</th><th>Status</th><th>Due</th><th>QB</th><th>Actions</th></tr></thead>
      <tbody>${invs.map(inv => `<tr>
        <td><strong>${esc(inv.invoice_number||'—')}</strong></td>
        <td class="text-sm">${inv.clients ? esc(`${inv.clients.first_name} ${inv.clients.last_name}`) : '—'}</td>
        <td class="text-sm">${esc(inv.jobs?.properties?.name||'—')}</td>
        <td><strong>${fmtMoney(inv.amount)}</strong></td>
        <td>${statusBadge(inv.status)}</td>
        <td class="text-sm">${fmtDate(inv.due_date)}</td>
        <td>${inv.quickbooks_invoice_id && !inv.quickbooks_invoice_id.startsWith('QB-') ? `<span class="badge badge-green">Synced</span>` : '—'}</td>
        <td class="td-actions">
          <button class="btn btn-sm btn-secondary" onclick="showInvoiceDetail('${inv.id}')">View</button>
          ${isAdmin() ? `<button class="btn btn-sm btn-gold" onclick="syncToQB('${inv.id}')">→ QB</button>` : ''}
        </td>
      </tr>`).join('')}</tbody>
    </table>`;
}

function setInvFilter(f) {
  _filter = f;
  document.querySelectorAll('.filter-tab').forEach(el => el.classList.toggle('active', el.textContent.trim() === f));
  loadInvTable();
}

async function showInvoiceDetail(id) {
  const { data: inv } = await sb.from('invoices').select('*, jobs(*, properties(name, address, city)), clients(first_name, last_name, email)').eq('id', id).single();
  if (!inv) return;
  openModal(`
    <div class="modal">
      <div class="modal-header"><h3>Invoice ${esc(inv.invoice_number||'')}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
      <div class="modal-body">
        <div class="job-detail-grid mb-16">
          <div class="detail-row"><span class="detail-label">Client</span><span class="detail-value">${inv.clients ? esc(`${inv.clients.first_name} ${inv.clients.last_name}`) : '—'}</span></div>
          <div class="detail-row"><span class="detail-label">Property</span><span class="detail-value">${esc(inv.jobs?.properties?.name||'—')}</span></div>
          <div class="detail-row"><span class="detail-label">Amount</span><span class="detail-value">${fmtMoney(inv.amount)}</span></div>
          <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value">${statusBadge(inv.status)}</span></div>
          <div class="detail-row"><span class="detail-label">Due Date</span><span class="detail-value">${fmtDate(inv.due_date)}</span></div>
          <div class="detail-row"><span class="detail-label">Paid At</span><span class="detail-value">${fmtDate(inv.paid_at)}</span></div>
          <div class="detail-row"><span class="detail-label">QB Invoice ID</span><span class="detail-value">${esc(inv.quickbooks_invoice_id||'Not synced')}</span></div>
          <div class="detail-row"><span class="detail-label">Job Date</span><span class="detail-value">${fmtDate(inv.jobs?.scheduled_date)}</span></div>
        </div>
        ${inv.notes ? `<div class="info-box mb-16">${esc(inv.notes)}</div>` : ''}
        <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
          ${inv.job_id ? `<button class="btn btn-secondary" onclick="closeModal();showJobDetail('${inv.job_id}')">View Job →</button>` : ''}
          <button class="btn btn-secondary" onclick="printInvoice('${inv.id}')">&#128424; Print</button>
        </div>
        ${isAdmin() ? `
        <div style="display:flex;flex-direction:column;gap:8px">
          <div class="form-grid">
            <div class="form-group"><label>Status</label>
              <select id="inv-status-sel">
                ${['draft','pending','paid','overdue'].map(s => `<option value="${s}" ${inv.status===s?'selected':''}>${s}</option>`).join('')}
              </select>
            </div>
            <div class="form-group"><label>Due Date</label><input type="date" id="inv-due-sel" value="${inv.due_date||''}"/></div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-primary" onclick="updateInvoice('${inv.id}')">Save Changes</button>
            <button class="btn btn-gold" onclick="syncToQB('${inv.id}')">→ Sync to QuickBooks</button>
          </div>
        </div>` : ''}
      </div>
    </div>`);
}

async function showInvoiceModal() {
  const [jobRes, clientRes] = await Promise.all([
    sb.from('jobs').select('id, scheduled_date, job_type, total_price, properties(name)').eq('status','completed').order('scheduled_date', { ascending: false }).limit(50),
    sb.from('clients').select('id, first_name, last_name').eq('status','active').order('last_name'),
  ]);
  openModal(`
    <div class="modal">
      <div class="modal-header"><h3>New Invoice</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
      <div class="modal-body">
        <form id="inv-form" onsubmit="createInvoice(event)">
          <div class="form-grid">
            <div class="form-group"><label>Client</label>
              <select id="inf-client">
                <option value="">None</option>
                ${(clientRes.data||[]).map(c => `<option value="${c.id}">${esc(c.first_name)} ${esc(c.last_name)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group"><label>Link to Job</label>
              <select id="inf-job" onchange="prefillInvAmount()">
                <option value="">None</option>
                ${(jobRes.data||[]).map(j => `<option value="${j.id}" data-amount="${j.total_price}">${fmtDate(j.scheduled_date)} — ${esc(j.properties?.name||'')} (${fmtMoney(j.total_price)})</option>`).join('')}
              </select>
            </div>
            <div class="form-group"><label>Amount ($) *</label><input type="number" id="inf-amount" step="0.01" min="0" required/></div>
            <div class="form-group"><label>Due Date</label><input type="date" id="inf-due"/></div>
            <div class="form-group form-full"><label>Notes</label><textarea id="inf-notes"></textarea></div>
          </div>
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="document.getElementById('inv-form').requestSubmit()">Create Invoice</button>
      </div>
    </div>`);
}

function prefillInvAmount() {
  const sel = document.getElementById('inf-job');
  const opt = sel?.options[sel.selectedIndex];
  if (opt?.dataset.amount) document.getElementById('inf-amount').value = opt.dataset.amount;
}

async function createInvoice(e) {
  e.preventDefault();
  const { count } = await sb.from('invoices').select('*', { count:'exact', head:true });
  const num = `INV-${String((count||0)+1).padStart(4,'0')}`;
  const payload = {
    job_id: document.getElementById('inf-job').value || null,
    client_id: document.getElementById('inf-client').value || null,
    invoice_number: num,
    amount: parseFloat(document.getElementById('inf-amount').value) || 0,
    status: 'pending',
    due_date: document.getElementById('inf-due').value || null,
    notes: document.getElementById('inf-notes').value.trim() || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb.from('invoices').insert(payload);
  if (error) { toast(error.message,'error'); return; }
  closeModal(); toast('Invoice created'); renderInvoices();
}

async function updateInvoice(id) {
  const status = document.getElementById('inv-status-sel').value;
  const due = document.getElementById('inv-due-sel').value;
  const payload = { status, due_date: due || null, updated_at: new Date().toISOString() };
  if (status === 'paid') payload.paid_at = new Date().toISOString();
  await sb.from('invoices').update(payload).eq('id', id);
  closeModal(); toast('Invoice updated'); renderInvoices();
}

async function syncToQB(invId) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { toast('Not logged in','error'); return; }
  toast('Syncing to QuickBooks…');
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/quickbooks-sync`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoice_id: invId }),
    });
    const json = await res.json();
    if (json.success) { toast('Synced to QuickBooks! QB ID: ' + json.quickbooks_invoice_id); renderInvoices(); }
    else toast(json.error || 'Sync failed', 'error');
  } catch (e) { toast('Network error: ' + e.message, 'error'); }
}

async function checkQBPayments() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return;
  toast('Checking QuickBooks for payments…');
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/quickbooks-payment-check`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    });
    const json = await res.json();
    toast(json.message || 'Done');
    if (json.updated > 0) renderInvoices();
  } catch (e) { toast('Error: ' + e.message, 'error'); }
}

async function exportInvoicesCSV() {
  const { data } = await sb.from('invoices')
    .select('invoice_number, amount, status, due_date, paid_at, created_at, notes, quickbooks_invoice_id, jobs(job_type, scheduled_date, properties(name)), clients(first_name, last_name)')
    .order('created_at', { ascending: false });
  if (!data?.length) { toast('No invoices to export', 'warning'); return; }
  const rows = [
    ['Invoice #', 'Client', 'Property', 'Job Type', 'Job Date', 'Amount', 'Status', 'Due Date', 'Paid At', 'QB Invoice ID', 'Notes'],
    ...data.map(i => [
      i.invoice_number || '',
      i.clients ? `${i.clients.first_name} ${i.clients.last_name}` : '',
      i.jobs?.properties?.name || '',
      i.jobs?.job_type || '',
      i.jobs?.scheduled_date || '',
      parseFloat(i.amount || 0).toFixed(2),
      i.status || '',
      i.due_date || '',
      i.paid_at ? i.paid_at.split('T')[0] : '',
      i.quickbooks_invoice_id || '',
      (i.notes || '').replace(/"/g, '""'),
    ]),
  ];
  const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `renovo-invoices-${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('CSV exported');
}

async function printInvoice(invId) {
  const { data: inv } = await sb.from('invoices')
    .select('*, jobs(*, properties(name, address, city, state)), clients(first_name, last_name, email)')
    .eq('id', invId).single();
  if (!inv) return;
  const client = inv.clients ? `${inv.clients.first_name} ${inv.clients.last_name}` : 'N/A';
  const prop = inv.jobs?.properties?.name || 'N/A';
  const addr = [inv.jobs?.properties?.address, inv.jobs?.properties?.city, inv.jobs?.properties?.state].filter(Boolean).join(', ') || '';
  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html><html><head><title>Invoice ${esc(inv.invoice_number||'')}</title>
  <style>
    body{font-family:'Arial',sans-serif;padding:40px;color:#1a1a1a;max-width:700px;margin:0 auto}
    h1{font-size:28px;color:#1e3a2f;margin-bottom:4px}
    .sub{color:#6b7280;font-size:14px;margin-bottom:32px}
    .two-col{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:28px}
    .label{font-size:11px;text-transform:uppercase;letter-spacing:.8px;color:#6b7280;margin-bottom:4px;font-weight:600}
    .value{font-size:15px;font-weight:500}
    table{width:100%;border-collapse:collapse;margin-bottom:20px}
    th{text-align:left;padding:10px 14px;background:#f7f5f1;font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:#6b7280}
    td{padding:12px 14px;border-bottom:1px solid #e2ddd6}
    .total-row td{font-weight:700;font-size:16px;border-bottom:none}
    .badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:500;background:#dcfce7;color:#166534}
    .badge.pending{background:#fef3c7;color:#92400e}
    .badge.overdue{background:#fee2e2;color:#991b1b}
    .footer{margin-top:40px;font-size:12px;color:#9ca3af;border-top:1px solid #e2ddd6;padding-top:16px}
    @media print{body{padding:20px}}
  </style></head><body>
  <h1>Renovo Co.</h1>
  <div class="sub">Cleaning &amp; Staging — Abilene, TX</div>
  <div class="two-col">
    <div>
      <div class="label">Invoice Number</div><div class="value">${esc(inv.invoice_number||'—')}</div>
      <br>
      <div class="label">Status</div>
      <div class="value"><span class="badge ${inv.status}">${esc(inv.status||'')}</span></div>
    </div>
    <div>
      <div class="label">Invoice Date</div><div class="value">${fmtDate(inv.created_at)}</div>
      <br>
      <div class="label">Due Date</div><div class="value">${fmtDate(inv.due_date)}</div>
    </div>
  </div>
  <div class="two-col">
    <div><div class="label">Bill To</div><div class="value">${esc(client)}</div>${inv.clients?.email?`<div style="font-size:13px;color:#6b7280">${esc(inv.clients.email)}</div>`:''}</div>
    <div><div class="label">Property</div><div class="value">${esc(prop)}</div>${addr?`<div style="font-size:13px;color:#6b7280">${esc(addr)}</div>`:''}</div>
  </div>
  <table>
    <thead><tr><th>Description</th><th style="text-align:right">Amount</th></tr></thead>
    <tbody>
      <tr><td>${esc((inv.jobs?.job_type||'Standard').charAt(0).toUpperCase()+(inv.jobs?.job_type||'standard').slice(1))} Clean — ${esc(prop)}${inv.jobs?.scheduled_date?` (${fmtDate(inv.jobs.scheduled_date)})`:''}${inv.notes?`<br><small style="color:#6b7280">${esc(inv.notes)}</small>`:''}</td><td style="text-align:right">${fmtMoney(inv.amount)}</td></tr>
    </tbody>
    <tfoot><tr class="total-row"><td>Total Due</td><td style="text-align:right">${fmtMoney(inv.amount)}</td></tr></tfoot>
  </table>
  ${inv.quickbooks_invoice_id && !inv.quickbooks_invoice_id.startsWith('QB-') ? `<p style="font-size:12px;color:#6b7280">QuickBooks Invoice ID: ${esc(inv.quickbooks_invoice_id)}</p>` : ''}
  <div class="footer">Renovo Co. · Abilene, TX · Thank you for your business!</div>
  <script>window.onload=()=>window.print();<\/script>
  </body></html>`);
  w.document.close();
}

// MEDIA
async function renderMedia() {
  const mc = document.getElementById('main-content');
  mc.innerHTML = `
    <div class="page-header"><h1>Media</h1></div>
    <div class="page-body">
      <div class="card mb-24">
        <div class="card-title mb-16">Upload Files</div>
        <div class="upload-zone" id="upload-zone" onclick="document.getElementById('file-input').click()" ondragover="handleDragOver(event)" ondrop="handleDrop(event)">
          <div style="font-size:36px">📁</div>
          <p>Click to upload or drag &amp; drop photos</p>
          <p style="font-size:12px;margin-top:4px;color:var(--muted)">JPG, PNG, GIF up to 10MB</p>
        </div>
        <input type="file" id="file-input" accept="image/*,video/*" multiple style="display:none" onchange="handleFileSelect(event)"/>
        <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap">
          <div class="form-group" style="flex:1;min-width:180px">
            <label>Property (optional)</label>
            <select id="upload-prop"><option value="">All properties</option></select>
          </div>
          <div class="form-group" style="flex:1;min-width:180px">
            <label>Job (optional)</label>
            <select id="upload-job"><option value="">No job</option></select>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-header">
          <span class="card-title">Gallery</span>
          <select id="media-filter-prop" onchange="loadMediaGallery()" style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--r);font-size:13px"><option value="">All properties</option></select>
        </div>
        <div id="media-gallery">Loading…</div>
      </div>
    </div>`;
  const { data: props } = await sb.from('properties').select('id, name').order('name');
  const { data: jobs } = await sb.from('jobs').select('id, scheduled_date, properties(name)').order('scheduled_date', { ascending: false }).limit(30);
  const propOpts = (props||[]).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  document.getElementById('upload-prop').innerHTML += propOpts;
  document.getElementById('media-filter-prop').innerHTML += propOpts;
  document.getElementById('upload-job').innerHTML += (jobs||[]).map(j => `<option value="${j.id}">${fmtDate(j.scheduled_date)} — ${esc(j.properties?.name||'')}</option>`).join('');
  loadMediaGallery();
}

function handleDragOver(e) { e.preventDefault(); document.getElementById('upload-zone').classList.add('drag'); }
function handleDrop(e) { e.preventDefault(); document.getElementById('upload-zone').classList.remove('drag'); processFiles(e.dataTransfer.files); }
function handleFileSelect(e) { processFiles(e.target.files); }

async function processFiles(files) {
  const propId = document.getElementById('upload-prop').value || null;
  const jobId = document.getElementById('upload-job').value || null;
  for (const file of files) {
    if (file.size > 10 * 1024 * 1024) { toast(`${file.name} is too large (max 10MB)`, 'warning'); continue; }
    toast(`Uploading ${file.name}…`);
    try {
      const ext = file.name.split('.').pop();
      const path = `${_user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error: upErr } = await sb.storage.from('media').upload(path, file, { cacheControl: '3600' });
      if (upErr) { toast(`Upload failed: ${upErr.message}`, 'error'); continue; }
      const { data: { publicUrl } } = sb.storage.from('media').getPublicUrl(path);
      await sb.from('media').insert({ property_id: propId, job_id: jobId, file_name: file.name, file_url: publicUrl, storage_path: path, file_type: file.type.startsWith('video') ? 'video' : 'image', created_at: new Date().toISOString() });
      toast(`${file.name} uploaded`);
    } catch (e) { toast(`Error: ${e.message}`, 'error'); }
  }
  loadMediaGallery();
}

async function loadMediaGallery() {
  const propFilter = document.getElementById('media-filter-prop')?.value;
  let q = sb.from('media').select('*, properties(name)').order('created_at', { ascending: false }).limit(60);
  if (propFilter) q = q.eq('property_id', propFilter);
  const { data } = await q;
  const items = data || [];
  const el = document.getElementById('media-gallery');
  if (!el) return;
  if (!items.length) { el.innerHTML = `<div class="empty-state"><div class="icon">📸</div><p>No media yet</p></div>`; return; }
  el.innerHTML = `<div class="media-grid">${items.map(m => `
    <div class="media-item">
      <img src="${esc(m.file_url)}" alt="${esc(m.file_name)}" loading="lazy"/>
      <div class="media-item-overlay">
        <a href="${esc(m.file_url)}" target="_blank" class="btn btn-sm btn-secondary">View</a>
        ${isAdmin() ? `<button class="btn btn-sm btn-danger" onclick="deleteMedia('${m.id}','${esc(m.storage_path)}')">Del</button>` : ''}
      </div>
    </div>`).join('')}</div>`;
}

async function deleteMedia(id, path) {
  if (!confirm('Delete this file?')) return;
  await sb.storage.from('media').remove([path]);
  await sb.from('media').delete().eq('id', id);
  toast('Deleted'); loadMediaGallery();
}

// MESSAGES
let _msgSub = null;
async function renderMessages() {
  const mc = document.getElementById('main-content');
  mc.innerHTML = `
    <div class="page-header"><h1>Team Messages</h1></div>
    <div class="page-body">
      <div class="card" style="display:flex;flex-direction:column;height:calc(100vh - 160px)">
        <div id="msg-list" style="flex:1;overflow-y:auto;padding:8px 0;display:flex;flex-direction:column;gap:4px">Loading…</div>
        <div style="border-top:1px solid var(--border);padding-top:14px;display:flex;gap:8px">
          <input id="msg-input" type="text" placeholder="Type a message…" style="flex:1;padding:10px 14px;border:1px solid var(--border);border-radius:var(--r)" onkeydown="if(event.key==='Enter')sendMessage()"/>
          <button class="btn btn-primary" onclick="sendMessage()">Send</button>
        </div>
      </div>
    </div>`;
  loadMessages();
  if (_msgSub) sb.removeChannel(_msgSub);
  _msgSub = sb.channel('messages-rt').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, p => appendMsg(p.new)).subscribe();
}

async function loadMessages() {
  const { data } = await sb.from('messages').select('*').order('created_at').limit(100);
  const el = document.getElementById('msg-list');
  if (!el) return;
  el.innerHTML = (data||[]).map(m => msgHTML(m)).join('');
  el.scrollTop = el.scrollHeight;
}

function msgHTML(m) {
  const isMe = m.user_id === _user?.id;
  return `<div style="display:flex;flex-direction:column;align-items:${isMe?'flex-end':'flex-start'};padding:4px 8px">
    <div style="max-width:70%;background:${isMe?'var(--green)':'var(--bg)'};color:${isMe?'#fff':'var(--text)'};padding:10px 14px;border-radius:${isMe?'14px 14px 4px 14px':'14px 14px 14px 4px'};font-size:14px">${esc(m.body)}</div>
    <div style="font-size:11px;color:var(--muted);margin-top:3px">${esc(m.sender_name)} · ${timeAgo(m.created_at)}</div>
  </div>`;
}

function appendMsg(m) {
  const el = document.getElementById('msg-list');
  if (!el) return;
  el.insertAdjacentHTML('beforeend', msgHTML(m));
  el.scrollTop = el.scrollHeight;
}

async function sendMessage() {
  const inp = document.getElementById('msg-input');
  const body = inp?.value.trim();
  if (!body) return;
  inp.value = '';
  const name = _profile?.full_name || _user?.email || 'User';
  await sb.from('messages').insert({ user_id: _user.id, sender_name: name, body, created_at: new Date().toISOString() });
}

// SETTINGS
async function renderSettings() {
  const mc = document.getElementById('main-content');
  const { data: qbToken } = await sb.from('integration_tokens').select('realm_id, expires_at, updated_at').eq('service','quickbooks').maybeSingle().catch(() => ({ data: null }));
  mc.innerHTML = `
    <div class="page-header"><h1>Settings</h1></div>
    <div class="page-body">
      <div class="two-col">
        <div>
          <div class="card mb-24">
            <div class="card-title mb-16">My Profile</div>
            <div class="form-grid">
              <div class="form-group form-full"><label>Display Name</label><input id="set-name" value="${esc(_profile?.full_name||'')}"/></div>
            </div>
            <div style="margin-top:12px"><button class="btn btn-primary" onclick="saveProfile()">Save Profile</button></div>
          </div>
          <div class="card mb-24">
            <div class="card-title mb-16">QuickBooks Integration</div>
            ${qbToken ? `
              <div class="info-box success mb-16">
                ✓ Connected — Realm ID: ${esc(qbToken.realm_id)}<br>
                <small>Last updated: ${fmtDate(qbToken.updated_at)}</small>
              </div>
              <button class="btn btn-secondary" onclick="connectQuickBooks()">Reconnect QuickBooks</button>`
            : `<p class="text-muted mb-16">Connect QuickBooks Online to sync invoices and track payments.</p>
               <button class="btn btn-gold" onclick="connectQuickBooks()">Connect QuickBooks →</button>`}
          </div>
        </div>
        <div>
          <div class="card mb-24">
            <div class="card-title mb-16">Booking Webhook</div>
            <p class="text-muted mb-16" style="font-size:13px">Connect Airbnb, VRBO, and Booking.com via Zapier or Make. Send booking data to this endpoint:</p>
            <div style="background:var(--bg);padding:12px;border-radius:var(--r);font-family:monospace;font-size:12px;word-break:break-all;margin-bottom:12px">
              ${esc(SUPABASE_URL)}/functions/v1/booking-webhook
            </div>
            <div class="info-box mb-16">
              <strong>Required headers:</strong><br>
              <code>Authorization: Bearer YOUR_BOOKING_API_KEY</code><br>
              <code>Content-Type: application/json</code>
            </div>
            <div class="info-box">
              <strong>Required fields:</strong><br>
              <code>platform</code> (airbnb / vrbo / booking.com)<br>
              <code>property_id</code> (UUID from this CRM)<br>
              <code>guest_name</code><br>
              <code>check_in</code> (ISO date)<br>
              <code>check_out</code> (ISO date)<br>
              <code>external_booking_id</code> (for dedup)<br>
              <code>status</code> (confirmed / cancelled)
            </div>
          </div>
          <div class="card">
            <div class="card-title mb-16">Environment Variables</div>
            <div style="font-size:13px;display:flex;flex-direction:column;gap:6px">
              ${[
                ['SUPABASE_URL', SUPABASE_URL],
                ['SUPABASE_ANON_KEY', SUPABASE_ANON_KEY.slice(0,20)+'…'],
                ['QUICKBOOKS_CLIENT_ID', 'Set in Supabase Edge Function Secrets'],
                ['QUICKBOOKS_CLIENT_SECRET', 'Set in Supabase Edge Function Secrets'],
                ['QUICKBOOKS_REDIRECT_URI', `${SUPABASE_URL}/functions/v1/quickbooks-callback`],
                ['BOOKING_API_KEY', 'Set in Supabase Edge Function Secrets'],
              ].map(([k,v]) => `<div style="display:flex;flex-direction:column;gap:2px">
                <span style="font-weight:600;font-size:12px;color:var(--muted)">${k}</span>
                <code style="font-size:12px;background:var(--bg);padding:4px 8px;border-radius:4px">${esc(v)}</code>
              </div>`).join('')}
            </div>
          </div>
        </div>
      </div>
      ${isAdmin() ? `
      <div class="card" style="margin-top:20px">
        <div class="card-title mb-16">User Setup Instructions</div>
        <p class="text-muted text-sm mb-16">Go to Supabase Dashboard → Authentication → Users → Invite User. After first sign-in, run these SQL commands:</p>
        <pre style="background:var(--bg);padding:16px;border-radius:var(--r);font-size:12px;overflow-x:auto">UPDATE profiles SET full_name = 'Caleb Gabbert',  role = 'admin'
  WHERE id = (SELECT id FROM auth.users WHERE email = 'caleb@renovoco.com');

UPDATE profiles SET full_name = 'Kennan Dowling', role = 'admin'
  WHERE id = (SELECT id FROM auth.users WHERE email = 'kennan@renovoco.com');

UPDATE profiles SET full_name = 'Mitchell',       role = 'admin'
  WHERE id = (SELECT id FROM auth.users WHERE email = 'mitchell@renovoco.com');</pre>
      </div>` : ''}
    </div>`;
}

async function saveProfile() {
  const name = document.getElementById('set-name').value.trim();
  if (!name) return;
  const { error } = await sb.from('profiles').update({ full_name: name, updated_at: new Date().toISOString() }).eq('id', _user.id);
  if (error) { toast(error.message,'error'); return; }
  _profile.full_name = name;
  document.getElementById('sidebar-user').innerHTML = `<strong>${esc(name)}</strong><span>${esc(_profile.role)}</span>`;
  toast('Profile saved');
}

async function connectQuickBooks() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { toast('Not logged in','error'); return; }
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/quickbooks-oauth`, {
      headers: { 'Authorization': `Bearer ${session.access_token}` },
    });
    const json = await res.json();
    if (json.url) { window.location.href = json.url; }
    else toast(json.error || 'Failed to get QB auth URL', 'error');
  } catch (e) { toast('Error: ' + e.message, 'error'); }
}

// BOOKINGS
async function renderBookings() {
  const mc = document.getElementById('main-content');
  mc.innerHTML = `
    <div class="page-header">
      <h1>Bookings</h1>
      ${isAdmin() ? `<button class="btn btn-primary" onclick="showBookingModal()">+ Add Booking</button>` : ''}
    </div>
    <div class="page-body">
      <div class="filter-tabs">
        ${['all','confirmed','pending','cancelled'].map(f => `
          <div class="filter-tab ${_filter===f?'active':''}" onclick="setBookingFilter('${f}')">${f}</div>`).join('')}
      </div>
      <div class="card"><div class="table-wrap" id="bookings-table">Loading…</div></div>
    </div>`;
  await loadBookingsTable();
}

async function loadBookingsTable() {
  let q = sb.from('bookings')
    .select('*, properties(name)')
    .order('check_in', { ascending: false })
    .limit(100);
  if (_filter !== 'all') q = q.eq('status', _filter);
  const { data, error } = await q;
  const el = document.getElementById('bookings-table');
  if (!el) return;
  if (error) { el.innerHTML = `<p class="text-muted" style="padding:20px">${esc(error.message)}</p>`; return; }
  const bookings = data || [];
  if (!bookings.length) {
    el.innerHTML = `<div class="empty-state"><div class="icon">📋</div><p>No bookings yet</p><div class="sub">Connect booking platforms via webhook or add manually</div></div>`;
    return;
  }
  el.innerHTML = `
    <table>
      <thead><tr>
        <th>Guest</th><th>Property</th><th>Platform</th><th>Check In</th><th>Check Out</th><th>Status</th><th>Source</th><th>Actions</th>
      </tr></thead>
      <tbody>${bookings.map(b => `<tr>
        <td>
          <strong>${esc(b.guest_name)}</strong>
          ${b.guest_email ? `<br><span class="text-sm text-muted">${esc(b.guest_email)}</span>` : ''}
        </td>
        <td class="text-sm">${esc(b.properties?.name || '—')}</td>
        <td>${statusBadge(b.platform)}</td>
        <td>${fmtDate(b.check_in)}</td>
        <td>${fmtDate(b.check_out)}</td>
        <td>${statusBadge(b.status)}</td>
        <td class="text-sm text-muted">${b.external_booking_id ? `<span class="tag">${esc(b.platform)}</span>` : 'manual'}</td>
        <td class="td-actions">
          <button class="btn btn-sm btn-secondary" onclick="showBookingDetail('${b.id}')">View</button>
          ${isAdmin() && b.status !== 'cancelled' ? `<button class="btn btn-sm btn-secondary" onclick="showBookingModal('${b.id}')">Edit</button>` : ''}
        </td>
      </tr>`).join('')}</tbody>
    </table>`;
}

function setBookingFilter(f) {
  _filter = f;
  document.querySelectorAll('.filter-tab').forEach(el => el.classList.toggle('active', el.textContent.trim() === f));
  loadBookingsTable();
}

async function showBookingModal(id = null) {
  const { data: props } = await sb.from('properties').select('id, name').eq('status','active').order('name');
  let b = null;
  if (id) { const { data } = await sb.from('bookings').select('*').eq('id', id).single(); b = data; }
  openModal(`
    <div class="modal modal-lg">
      <div class="modal-header">
        <h3>${id ? 'Edit Booking' : 'New Booking'}</h3>
        <button class="modal-close" onclick="closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <form id="booking-form" onsubmit="saveBooking(event,'${id||''}')">
          <div class="form-grid">
            <div class="form-group form-full">
              <label>Property *</label>
              <select id="bf-prop" required>
                <option value="">Select property…</option>
                ${(props||[]).map(p => `<option value="${p.id}" ${b?.property_id===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}
              </select>
            </div>
            <div class="form-group"><label>Guest Name *</label><input id="bf-guest" value="${esc(b?.guest_name||'')}" required/></div>
            <div class="form-group"><label>Guest Email</label><input type="email" id="bf-email" value="${esc(b?.guest_email||'')}"/></div>
            <div class="form-group"><label>Platform</label>
              <select id="bf-platform">
                ${['airbnb','vrbo','booking.com','direct'].map(pl => `<option value="${pl}" ${(b?.platform||'airbnb')===pl?'selected':''}>${pl}</option>`).join('')}
              </select>
            </div>
            <div class="form-group"><label>Status</label>
              <select id="bf-status">
                ${['confirmed','pending','cancelled'].map(s => `<option value="${s}" ${(b?.status||'confirmed')===s?'selected':''}>${s}</option>`).join('')}
              </select>
            </div>
            <div class="form-group"><label>Check In *</label><input type="date" id="bf-checkin" value="${b?.check_in?b.check_in.split('T')[0]:''}" required/></div>
            <div class="form-group"><label>Check Out</label><input type="date" id="bf-checkout" value="${b?.check_out?b.check_out.split('T')[0]:''}" /></div>
            <div class="form-group"><label>Guests</label><input type="number" id="bf-guests" min="1" value="${b?.guests_count||1}"/></div>
            <div class="form-group"><label>Booking Total ($)</label><input type="number" id="bf-amount" step="0.01" min="0" value="${b?.total_amount||''}"/></div>
            <div class="form-group form-full"><label>External Booking ID <span class="form-hint">(from platform, used for dedup)</span></label><input id="bf-extid" value="${esc(b?.external_booking_id||'')}"/></div>
            <div class="form-group form-full"><label>Notes</label><textarea id="bf-notes">${esc(b?.notes||'')}</textarea></div>
          </div>
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="document.getElementById('booking-form').requestSubmit()">${id ? 'Save Changes' : 'Create Booking'}</button>
      </div>
    </div>`);
}

async function saveBooking(e, id) {
  e.preventDefault();
  const status = document.getElementById('bf-status').value;
  const checkin = document.getElementById('bf-checkin').value;
  const checkout = document.getElementById('bf-checkout').value;
  const propId = document.getElementById('bf-prop').value;
  const payload = {
    property_id: propId,
    guest_name: document.getElementById('bf-guest').value.trim(),
    guest_email: document.getElementById('bf-email').value.trim() || null,
    platform: document.getElementById('bf-platform').value,
    status,
    check_in: checkin ? new Date(checkin + 'T14:00:00').toISOString() : null,
    check_out: checkout ? new Date(checkout + 'T11:00:00').toISOString() : null,
    guests_count: parseInt(document.getElementById('bf-guests').value) || 1,
    total_amount: parseFloat(document.getElementById('bf-amount').value) || null,
    external_booking_id: document.getElementById('bf-extid').value.trim() || null,
    notes: document.getElementById('bf-notes').value.trim() || null,
    updated_at: new Date().toISOString(),
  };
  let bookingId = id;
  if (id) {
    const { error } = await sb.from('bookings').update(payload).eq('id', id);
    if (error) { toast(error.message, 'error'); return; }
  } else {
    const { data, error } = await sb.from('bookings').insert({ ...payload, created_at: new Date().toISOString() }).select().single();
    if (error) { toast(error.message, 'error'); return; }
    bookingId = data.id;
    if (status === 'confirmed') {
      await autoCreateJobFromBooking(bookingId, propId, checkout || checkin, payload.platform, payload.guest_name);
    }
  }
  closeModal(); toast(id ? 'Booking updated' : 'Booking created'); renderBookings();
}

async function autoCreateJobFromBooking(bookingId, propertyId, cleanDate, platform, guestName) {
  const { data: prop } = await sb.from('properties').select('bedrooms, bathrooms, name').eq('id', propertyId).single();
  if (!prop) return;
  const beds = prop.bedrooms || 1;
  const baths = prop.bathrooms || 1;
  const p = calcJobPrice(beds, baths, false, false);
  let base = 80, bedCharge = 0, bathCharge = 0;
  if (beds >= 4) { base = 230; } else { bedCharge = beds * 30; bathCharge = baths * 20; }
  const dateStr = cleanDate ? new Date(cleanDate).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
  const { data: existing } = await sb.from('jobs').select('id').eq('booking_id', bookingId).maybeSingle();
  if (existing) return;
  const { data: newJob } = await sb.from('jobs').insert({
    property_id: propertyId,
    booking_id: bookingId,
    job_type: 'standard',
    status: 'pending',
    scheduled_date: dateStr,
    scheduled_time: '10:00',
    base_price: base,
    bedroom_charge: bedCharge,
    bathroom_charge: bathCharge,
    rush_charge: 0,
    deep_clean_multiplier: 1,
    total_price: p.total,
    auto_generated: true,
    notes: `Auto-created from ${platform} booking: ${guestName}`,
    created_at: new Date().toISOString(),
  }).select().single();
  if (newJob) {
    await createChecklist(newJob.id);
    await logActivity(`Booking created — cleaning job auto-generated for ${prop.name} on ${dateStr}`);
  }
}

async function showBookingDetail(id) {
  const { data: b } = await sb.from('bookings')
    .select('*, properties(name, address, city), jobs(id, status, scheduled_date, total_price, job_type)')
    .eq('id', id).single();
  if (!b) return;
  openModal(`
    <div class="modal modal-lg">
      <div class="modal-header">
        <h3>Booking — ${esc(b.guest_name)}</h3>
        <button class="modal-close" onclick="closeModal()">&times;</button>
      </div>
      <div class="modal-body">
        <div class="job-detail-grid mb-16">
          <div class="detail-row"><span class="detail-label">Property</span><span class="detail-value">${esc(b.properties?.name || '—')}</span></div>
          <div class="detail-row"><span class="detail-label">Platform</span><span class="detail-value">${statusBadge(b.platform)}</span></div>
          <div class="detail-row"><span class="detail-label">Guest Email</span><span class="detail-value">${esc(b.guest_email || '—')}</span></div>
          <div class="detail-row"><span class="detail-label">Guests</span><span class="detail-value">${b.guests_count || 1}</span></div>
          <div class="detail-row"><span class="detail-label">Check In</span><span class="detail-value">${fmtDate(b.check_in)}</span></div>
          <div class="detail-row"><span class="detail-label">Check Out</span><span class="detail-value">${fmtDate(b.check_out)}</span></div>
          <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value">${statusBadge(b.status)}</span></div>
          <div class="detail-row"><span class="detail-label">Booking Total</span><span class="detail-value">${b.total_amount ? fmtMoney(b.total_amount) : '—'}</span></div>
          ${b.external_booking_id ? `<div class="detail-row"><span class="detail-label">Platform ID</span><span class="detail-value text-sm">${esc(b.external_booking_id)}</span></div>` : ''}
        </div>
        ${b.notes ? `<div class="info-box mb-16">${esc(b.notes)}</div>` : ''}
        ${b.jobs ? `
          <div class="section-title">Linked Cleaning Job</div>
          <div class="job-detail-grid mb-16">
            <div class="detail-row"><span class="detail-label">Scheduled</span><span class="detail-value">${fmtDate(b.jobs.scheduled_date)}</span></div>
            <div class="detail-row"><span class="detail-label">Type</span><span class="detail-value">${statusBadge(b.jobs.job_type)}</span></div>
            <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value">${statusBadge(b.jobs.status)}</span></div>
            <div class="detail-row"><span class="detail-label">Price</span><span class="detail-value">${fmtMoney(b.jobs.total_price)}</span></div>
          </div>
          <button class="btn btn-secondary" onclick="closeModal();showJobDetail('${b.jobs.id}')">View Job →</button>
        ` : `<div class="info-box warning">No cleaning job linked to this booking yet.</div>`}
        ${isAdmin() && b.status !== 'cancelled' ? `
          <div style="margin-top:16px;display:flex;gap:8px">
            <button class="btn btn-secondary" onclick="closeModal();showBookingModal('${b.id}')">Edit Booking</button>
            <button class="btn btn-danger" onclick="cancelBooking('${b.id}')">Cancel Booking</button>
          </div>` : ''}
      </div>
    </div>`);
}

async function cancelBooking(id) {
  if (!confirm('Cancel this booking? The linked job will also be cancelled if not already complete.')) return;
  const now = new Date().toISOString();
  await sb.from('bookings').update({ status: 'cancelled', updated_at: now }).eq('id', id);
  const { data: job } = await sb.from('jobs').select('id, status').eq('booking_id', id).maybeSingle();
  if (job && !['completed','cancelled'].includes(job.status)) {
    await sb.from('jobs').update({ status: 'cancelled', updated_at: now }).eq('id', job.id);
    await logActivity(`Booking cancelled — linked job cancelled`);
  }
  closeModal(); toast('Booking cancelled');
  if (_section === 'bookings') renderBookings();
}

// CALENDAR
async function renderCalendar() {
  const mc = document.getElementById('main-content');
  const now = new Date();
  mc.innerHTML = `
    <div class="page-header"><h1>Calendar</h1></div>
    <div class="page-body">
      <div class="card" style="padding:24px">
        <div id="cal-container">Loading…</div>
      </div>
    </div>`;
  await renderCalendarMonth(now.getFullYear(), now.getMonth());
}

async function renderCalendarMonth(year, month) {
  const monthName = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startStr = `${year}-${String(month+1).padStart(2,'0')}-01`;
  const endStr = `${year}-${String(month+1).padStart(2,'0')}-${String(daysInMonth).padStart(2,'0')}`;

  const { data: jobs } = await sb.from('jobs')
    .select('id, scheduled_date, scheduled_time, job_type, status, total_price, properties(name)')
    .gte('scheduled_date', startStr)
    .lte('scheduled_date', endStr)
    .neq('status', 'cancelled')
    .order('scheduled_time');

  const jobsByDate = {};
  (jobs || []).forEach(j => {
    if (!jobsByDate[j.scheduled_date]) jobsByDate[j.scheduled_date] = [];
    jobsByDate[j.scheduled_date].push(j);
  });

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(`<div class="cal-empty"></div>`);
  const today = new Date().toISOString().split('T')[0];
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dayJobs = jobsByDate[dateStr] || [];
    const isToday = dateStr === today;
    cells.push(`
      <div class="cal-cell ${isToday ? 'cal-today' : ''}">
        <span class="cal-day-num">${d}</span>
        ${dayJobs.map(j => {
          const cls = j.job_type === 'rush' ? 'rush' : j.job_type === 'deep' ? 'deep' : '';
          const label = (j.properties?.name || 'Job').slice(0, 18) + ((j.properties?.name||'').length > 18 ? '…' : '');
          return `<div class="cal-job ${cls}" onclick="showJobDetail('${j.id}')" title="${esc(j.properties?.name||'')} — ${esc(j.job_type)} (${fmtMoney(j.total_price)})">${esc(label)}</div>`;
        }).join('')}
      </div>`);
  }

  const container = document.getElementById('cal-container');
  if (!container) return;
  const prevYear = month === 0 ? year - 1 : year;
  const prevMonth = month === 0 ? 11 : month - 1;
  const nextYear = month === 11 ? year + 1 : year;
  const nextMonth = month === 11 ? 0 : month + 1;

  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <button class="btn btn-secondary" onclick="renderCalendarMonth(${prevYear},${prevMonth})">&#8592; Prev</button>
      <h3 style="font-size:18px;font-weight:600;font-family:'DM Sans',sans-serif;color:var(--green)">${monthName}</h3>
      <button class="btn btn-secondary" onclick="renderCalendarMonth(${nextYear},${nextMonth})">Next &#8594;</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:6px">
      ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => `<div style="text-align:center;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);padding:6px 0">${d}</div>`).join('')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px">
      ${cells.join('')}
    </div>
    <div style="margin-top:14px;display:flex;gap:12px;font-size:12px;color:var(--muted)">
      <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--green);margin-right:4px"></span>Standard</span>
      <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--danger);margin-right:4px"></span>Rush</span>
      <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--info);margin-right:4px"></span>Deep Clean</span>
    </div>`;
}

// INIT
sb.auth.onAuthStateChange(async (event, session) => {
  _user = session?.user || null;
  if (_user) {
    const { data: profile } = await sb.from('profiles').select('*').eq('id', _user.id).maybeSingle();
    _profile = profile;
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
    checkURLParams();
    renderShell();
  } else {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('app-shell').classList.add('hidden');
    if (_msgSub) { sb.removeChannel(_msgSub); _msgSub = null; }
  }
});

function checkURLParams() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('qb_connected')) {
    toast('QuickBooks connected successfully!');
    _section = 'settings';
    history.replaceState({}, '', window.location.pathname);
  }
  if (params.get('qb_error')) {
    toast('QuickBooks error: ' + decodeURIComponent(params.get('qb_error')), 'error');
    history.replaceState({}, '', window.location.pathname);
  }
}

(async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    document.getElementById('login-screen').classList.remove('hidden');
  }
})();
