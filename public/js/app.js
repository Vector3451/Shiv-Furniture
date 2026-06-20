// public/js/app.js — Core Client Application logic for Mini ERP System

const API_BASE = '';
let currentUser = null;
let activePage = 'dashboard';
let charts = {};

// Helpers
const $ = id => document.getElementById(id);

const format = {
  currency: val => '₹' + Number(val || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  number: val => Number(val || 0).toLocaleString('en-IN'),
  qty: val => Number(val || 0).toFixed(2),
  date: val => val ? new Date(val).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—',
  datetime: val => val ? new Date(val).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
};

function toast(message, type = 'success') {
  const t = $('toast');
  t.textContent = message;
  t.className = `toast ${type} show`;
  setTimeout(() => t.classList.remove('show'), 3500);
}

function showLoader(show) {
  // Loading overlay disabled for smoother performance
}

// Modal open/close utilities
function openModal(id) {
  $(id).classList.add('open');
  $('modalOverlay').classList.add('open');
}

function closeModal(id) {
  $(id).classList.remove('open');
  $('modalOverlay').classList.remove('open');
}

// Close modals when clicking overlay
$('modalOverlay').addEventListener('click', () => {
  document.querySelectorAll('.side-modal').forEach(m => m.classList.remove('open'));
  $('modalOverlay').classList.remove('open');
});

// Custom status badges builder
function buildBadge(status, type = '') {
  if (!status) return '<span class="text-muted">—</span>';
  const display = status.replace(/_/g, ' ');
  return `<span class="badge badge-${status.toLowerCase()}">${display}</span>`;
}

// Fetch JSON utility
async function apiFetch(url, options = {}) {
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    
    if (res.status === 401) {
      toast('Session expired. Redirecting to login...', 'error');
      setTimeout(() => window.location.href = '/login.html', 1500);
      return null;
    }
    
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `HTTP error ${res.status}`);
    }
    return data;
  } catch (err) {
    console.error('API Fetch Error:', err);
    toast(err.message, 'error');
    throw err;
  }
}

// ── Routing & Access Control ──────────────────────────────────────────────
async function checkAuth() {
  try {
    const user = await apiFetch('/api/auth/me');
    if (!user) return;
    
    currentUser = user;
    $('profileName').textContent = user.full_name;
    $('profileRole').textContent = user.role.replace(/_/g, ' ');
    
    if (user.avatar_url) {
      $('userAvatar').src = user.avatar_url;
      $('userAvatar').style.display = 'block';
      $('userAvatarPlaceholder').style.display = 'none';
    } else {
      $('userAvatarPlaceholder').textContent = user.full_name.charAt(0).toUpperCase();
      $('userAvatar').style.display = 'none';
      $('userAvatarPlaceholder').style.display = 'flex';
    }

    // Elevate Role UI config
    const elevContainer = $('elevatePrivilegeContainer');
    if (elevContainer) {
      if (user.role === 'admin') {
        elevContainer.style.display = 'flex';
        updateElevationHeaderUI(user.isElevated);
      } else {
        elevContainer.style.display = 'none';
      }
    }

    // Role-based navigation item hiding
    enforceModulePermissions(user);
    
    // Initial page load
    navigateTo(activePage);
  } catch (err) {
    window.location.href = '/login.html';
  }
}

function updateElevationHeaderUI(isElevated) {
  const btnElevate = $('btnElevateRole');
  const badgeElevated = $('elevatedRoleBadge');
  if (isElevated) {
    if (btnElevate) btnElevate.style.display = 'none';
    if (badgeElevated) badgeElevated.style.display = 'flex';
  } else {
    if (btnElevate) btnElevate.style.display = 'flex';
    if (badgeElevated) badgeElevated.style.display = 'none';
  }
}

function showLockScreen(containerId, description, onElevateClick) {
  const container = $(containerId);
  container.innerHTML = `
    <div class="lock-screen-wrapper" style="margin: 20px;">
      <div class="lock-icon">🔒</div>
      <div class="lock-title">Security Admin Elevation Required</div>
      <div class="lock-desc" style="margin: 10px 0 20px; font-size: 13.5px; color: var(--text-secondary); max-width: 450px; line-height: 1.5;">${description}</div>
      <button class="btn btn-primary" id="btnLockScreenElevate">🛡️ Elevate Session Privileges</button>
    </div>
  `;
  $('btnLockScreenElevate').onclick = onElevateClick;
}

function enforceModulePermissions(user) {
  // Access matrix:
  const rights = {};
  if (user.role === 'admin') {
    // Admins have access to all modules
    ['products','sales','purchase','manufacturing','bom','inventory','audit','users','incidents'].forEach(m => rights[m] = 'admin');
  } else {
    // Load custom rights mapped from the API database
    (user.access_rights || []).forEach(ar => {
      let moduleName = ar.module;
      if (moduleName === 'audit_logs') moduleName = 'audit';
      rights[moduleName] = ar.access_type;
    });
  }

  // Set default rights for dashboard and incidents
  rights['dashboard'] = 'user';
  rights['incidents'] = 'user';

  // Toggle nav element visibility
  const navItems = {
    dashboard: 'nav-dashboard',
    products: 'nav-products',
    parties: 'nav-parties',
    sales: 'nav-sales',
    purchases: 'nav-purchases',
    manufacturing: 'nav-manufacturing',
    inventory: 'nav-inventory',
    boms: 'nav-boms',
    incidents: 'nav-incidents',
    users: 'nav-users',
    audit: 'nav-audit'
  };

  Object.entries(navItems).forEach(([module, id]) => {
    const el = $(id);
    if (!el) return;
    const access = rights[module];
    if (access && access !== 'none') {
      el.style.display = 'flex';
    } else {
      el.style.display = 'none';
    }
  });

  // Save parsed rights globally
  currentUser.parsedRights = rights;
}

function navigateTo(page) {
  // Check permission
  if (currentUser && currentUser.parsedRights && currentUser.parsedRights[page] === 'none') {
    toast('Access Denied for this module', 'error');
    return;
  }

  activePage = page;
  
  // Set navbar classes
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  
  // Set active page view classes
  document.querySelectorAll('.page').forEach(el => {
    el.classList.toggle('active', el.id === `page-${page}`);
  });
  
  // Set Page Titles & Breadcrumbs
  const titles = {
    dashboard: 'Dashboard Overview',
    products: 'Product Catalog & Inventory',
    parties: 'Customers & Vendors Directory',
    sales: 'Sales Orders Workspace',
    purchases: 'Procurements & Purchase Orders',
    manufacturing: 'Shopfloor Manufacturing Routing',
    inventory: 'Stock Movement Audit Ledger',
    boms: 'Manufacturing Bill of Materials (BoM)',
    incidents: 'Service Desk Incidents & SLAs',
    users: 'System Users Access Rights',
    audit: 'Database Security Audit Trial'
  };

  $('pageTitle').textContent = titles[page] || 'Mini ERP';
  $('breadcrumbCurrent').textContent = page.charAt(0).toUpperCase() + page.slice(1);

  // If Audit page is active but not elevated, render lock screen and abort API calls
  if (page === 'audit' && !currentUser.isElevated) {
    showLockScreen('page-audit', 'The System Security Audit Trail contains sensitive records of all user logins, logouts, transactions, and system updates. You must elevate your role to Security Admin to view the logs.', () => openModal('modalElevateRole'));
    return;
  }

  // Load page data
  loadPageData(page);
}

// Dispatch to correct page data fetcher
function loadPageData(page) {
  switch (page) {
    case 'dashboard': loadDashboard(); break;
    case 'products': loadProducts(); break;
    case 'parties': loadParties(); break;
    case 'sales': loadSalesOrders(); break;
    case 'purchases': loadPurchaseOrders(); break;
    case 'manufacturing': loadManufacturing(); break;
    case 'inventory': loadInventoryLedger(); break;
    case 'boms': loadBoms(); break;
    case 'incidents': loadIncidents(); break;
    case 'users': loadUsers(); break;
    case 'audit': loadAuditLogs(); break;
  }
}

// Setup navbar triggers
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    navigateTo(item.dataset.page);
  });
});

$('refreshBtn').addEventListener('click', () => {
  loadPageData(activePage);
  toast('Data refreshed ✓');
});

// Logout Trigger
$('logoutBtn').addEventListener('click', async () => {
  showLoader(true);
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
    toast('Logged out successfully');
    window.location.href = '/login.html';
  } catch (err) {
    toast('Logout failed', 'error');
  } finally {
    showLoader(false);
  }
});

// ── Dashboard Data & Analytics Charts ─────────────────────────────────────
async function loadDashboard() {
  showLoader(true);
  try {
    const summary = await apiFetch('/api/analytics/summary');
    const trendData = await apiFetch('/api/analytics/sales-trend');
    const moStatus = await apiFetch('/api/analytics/mo-status');
    const productTypes = await apiFetch('/api/analytics/product-types');
    const recentSales = await apiFetch('/api/sales?limit=6');

    // Populate KPIs
    $('kpi-revenue').textContent = format.currency(summary.sales?.total_revenue || 0);
    $('kpi-revenue-sub').textContent = `${summary.sales?.confirmed || 0} confirmed orders`;
    $('kpi-sales').textContent = format.number(summary.sales?.total || 0);
    $('kpi-sales-sub').textContent = `${summary.sales?.delivered || 0} fully delivered`;
    
    $('kpi-purchases').textContent = format.number(summary.purchases?.total || 0);
    $('kpi-purchases-sub').textContent = `${summary.purchases?.received || 0} fully received`;
    
    $('kpi-mfg').textContent = format.number(summary.manufacturing?.total || 0);
    $('kpi-mfg-sub').textContent = `${summary.manufacturing?.in_progress || 0} in shopfloor`;
    
    $('kpi-products').textContent = format.number(summary.products?.active || 0);
    
    $('kpi-lowstock').textContent = format.number(summary.stock?.low_stock_count || 0);
    $('kpi-lowstock-sub').textContent = `${summary.stock?.low_stock_count || 0} item alerts`;

    // Render Charts
    renderSalesChart(trendData);
    renderMoStatusChart(moStatus);
    renderProductChart(productTypes);

    // Populate Recent Sales Table
    const tbody = $('recentSales');
    tbody.innerHTML = '';
    
    if (!recentSales.data || recentSales.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No recent sales records.</td></tr>';
      return;
    }

    recentSales.data.forEach(so => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="mono">${so.order_number}</span></td>
        <td><strong>${so.customer_name}</strong></td>
        <td>${format.currency(so.total_amount)}</td>
        <td>${buildBadge(so.status)}</td>
        <td>${format.date(so.expected_delivery)}</td>
      `;
      tbody.appendChild(tr);
    });

  } catch (err) {
    console.error('Error loading dashboard:', err);
  } finally {
    showLoader(false);
  }
}

function renderSalesChart(data) {
  const ctx = $('salesChart').getContext('2d');
  if (charts.sales) charts.sales.destroy();

  const labels = data.map(d => format.date(d.date));
  const values = data.map(d => parseFloat(d.revenue || 0));

  const gradientStroke = ctx.createLinearGradient(0, 0, 0, 240);
  gradientStroke.addColorStop(0, '#6366f1'); // Indigo
  gradientStroke.addColorStop(1, '#06b6d4'); // Cyan

  const gradientFill = ctx.createLinearGradient(0, 0, 0, 240);
  gradientFill.addColorStop(0, 'rgba(99, 102, 241, 0.2)');
  gradientFill.addColorStop(1, 'rgba(6, 182, 212, 0.0)');

  charts.sales = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Gross Revenue (INR)',
        data: values,
        borderColor: gradientStroke,
        backgroundColor: gradientFill,
        borderWidth: 3,
        tension: 0.4,
        fill: true,
        pointBackgroundColor: '#6366f1',
        pointBorderColor: '#ffffff',
        pointHoverBackgroundColor: '#ffffff',
        pointHoverBorderColor: '#06b6d4',
        pointBorderWidth: 1.5,
        pointHoverBorderWidth: 3,
        pointRadius: 3,
        pointHoverRadius: 5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 1000,
        easing: 'easeOutQuart'
      },
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#94a3b8', font: { size: 10 } } },
        y: { grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#94a3b8', font: { size: 10 }, callback: val => '₹' + (val / 1000).toFixed(0) + 'k' } }
      }
    }
  });
}

function renderMoStatusChart(data) {
  const ctx = $('moChart').getContext('2d');
  if (charts.mo) charts.mo.destroy();

  const statusColors = {
    draft: '#94a3b8',
    confirmed: '#38bdf8',
    in_progress: '#fbbf24',
    partially_produced: '#fb923c',
    completed: '#34d399',
    cancelled: '#f87171'
  };

  const labels = data.map(d => d.status.replace(/_/g, ' '));
  const values = data.map(d => parseInt(d.count));
  const backgroundColors = data.map(d => statusColors[d.status] || '#64748b');

  charts.mo = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: backgroundColors,
        borderWidth: 2,
        borderColor: '#1e293b',
        borderRadius: 4,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '75%',
      animation: {
        duration: 1000,
        easing: 'easeOutQuart'
      },
      plugins: {
        legend: {
          position: 'right',
          labels: { color: '#cbd5e1', font: { size: 11 }, boxWidth: 10, padding: 14 }
        }
      }
    }
  });
}

function renderProductChart(data) {
  const ctx = $('productChart').getContext('2d');
  if (charts.product) charts.product.destroy();

  const palette = {
    raw_material: '#fb923c', // Amber-Orange
    component: '#6366f1',    // Indigo
    finished_good: '#34d399'  // Emerald
  };

  const labels = data.map(d => d.product_type.replace(/_/g, ' '));
  const values = data.map(d => parseInt(d.count));
  const backgroundColors = data.map(d => palette[d.product_type] || '#64748b');

  charts.product = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: backgroundColors,
        borderWidth: 2,
        borderColor: '#1e293b',
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '75%',
      animation: {
        duration: 1000,
        easing: 'easeOutQuart'
      },
      plugins: { legend: { display: false } }
    }
  });

  // Custom legend building
  const legendEl = $('productLegend');
  legendEl.innerHTML = '';
  data.forEach(d => {
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `
      <div class="legend-dot" style="background: ${palette[d.product_type] || '#4b5563'}"></div>
      <span class="legend-label">${d.product_type.replace(/_/g, ' ')}</span>
      <span class="legend-value">${d.count}</span>
    `;
    legendEl.appendChild(item);
  });
}


// ── Products CRUD Logic ──────────────────────────────────────────────────
let productsCache = [];
async function loadProducts() {
  showLoader(true);
  try {
    const type = $('productTypeFilter').value;
    const search = $('productSearch').value.trim();
    
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (search) params.set('search', search);

    const res = await apiFetch(`/api/products?${params.toString()}`);
    productsCache = res.data || [];

    const tbody = $('productsTable');
    tbody.innerHTML = '';
    
    if (productsCache.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted p-4">No catalog items match current filters.</td></tr>';
      $('productsCount').textContent = '0 items';
      return;
    }

    $('productsCount').textContent = `${res.total} items in catalog`;

    productsCache.forEach(p => {
      const freeClass = parseFloat(p.free_to_use_qty) < parseFloat(p.min_stock_level) ? 'qty-negative' : 'qty-positive';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="mono">${p.sku}</span></td>
        <td>
          <strong>${p.name}</strong><br>
          <small class="text-muted">${p.description || 'No description provided'}</small>
        </td>
        <td>${buildBadge(p.product_type)}</td>
        <td><strong>${format.currency(p.sales_price)}</strong></td>
        <td>${format.currency(p.cost_price)}</td>
        <td class="qty-neutral">${format.qty(p.on_hand_qty)}</td>
        <td class="qty-neutral">${format.qty(p.reserved_qty)}</td>
        <td class="${freeClass}">${format.qty(p.free_to_use_qty)} ${p.unit_of_measure}</td>
        <td>
          <div class="btn-row-actions">
            <button class="btn btn-secondary btn-xs" onclick="editProduct('${p.id}')">Edit</button>
            <button class="btn btn-secondary btn-xs" onclick="triggerAdjustment('${p.id}')">Adjust Stock</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });

  } catch (err) {
    console.error(err);
  } finally {
    showLoader(false);
  }
}

// Wire form filters for products
$('productTypeFilter').addEventListener('change', loadProducts);
$('productSearch').addEventListener('input', debounce(loadProducts, 350));

// Add Product Modal
$('btnAddProduct').addEventListener('click', async () => {
  $('productForm').reset();
  $('productId').value = '';
  $('modalProductTitle').textContent = 'New Catalog Product';
  
  // Populate vendors
  await populateVendorsSelect('procVendor');
  
  openModal('modalProduct');
});

async function populateVendorsSelect(elId) {
  const select = $(elId);
  select.innerHTML = '<option value="">-- Select Vendor Account --</option>';
  try {
    const list = await apiFetch('/api/parties?role=vendor');
    list.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = `${v.name} (${v.party_code})`;
      select.appendChild(opt);
    });
  } catch (e) { console.error('Failed to load vendors', e); }
}

// Edit product loader
async function editProduct(id) {
  showLoader(true);
  try {
    await populateVendorsSelect('procVendor');
    
    const prod = await apiFetch(`/api/products/${id}`);
    
    $('productId').value = prod.id;
    $('pName').value = prod.name;
    $('pSku').value = prod.sku;
    $('pSku').disabled = true; // Disable SKU editing to prevent DB code breaks
    $('pDescription').value = prod.description || '';
    $('pType').value = prod.product_type;
    $('pSalesPrice').value = prod.sales_price;
    $('pCostPrice').value = prod.cost_price;
    $('pUom').value = prod.unit_of_measure;
    $('pMinStock').value = prod.min_stock_level;
    
    $('procStrategy').value = prod.strategy || 'MTS';
    $('procType').value = prod.procurement_type || 'purchase';
    $('procVendor').value = prod.vendor_party_id || '';
    $('procLeadTime').value = prod.lead_time_days || 0;
    $('procMinOrder').value = prod.min_order_qty || 1;
    
    $('modalProductTitle').textContent = 'Edit Product Details';
    
    openModal('modalProduct');
  } catch (err) {
    console.error(err);
  } finally {
    showLoader(false);
  }
}

// Save Product Handler
$('productForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('productId').value;
  
  const payload = {
    name: $('pName').value.trim(),
    sku: $('pSku').value.trim(),
    description: $('pDescription').value.trim(),
    product_type: $('pType').value,
    sales_price: parseFloat($('pSalesPrice').value) || 0,
    cost_price: parseFloat($('pCostPrice').value) || 0,
    unit_of_measure: $('pUom').value.trim(),
    min_stock_level: parseFloat($('pMinStock').value) || 0,
    strategy: $('procStrategy').value,
    procurement_type: $('procType').value,
    vendor_party_id: $('procVendor').value || null,
    lead_time_days: parseInt($('procLeadTime').value) || 0,
    min_order_qty: parseFloat($('procMinOrder').value) || 1
  };

  showLoader(true);
  try {
    if (id) {
      // Edit
      await apiFetch(`/api/products/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      toast('Product updated successfully');
    } else {
      // Create
      await apiFetch('/api/products', {
        method: 'POST',
        body: JSON.stringify({ ...payload, opening_qty: 0 })
      });
      toast('Product created successfully');
    }
    closeModal('modalProduct');
    loadProducts();
  } catch (e) {
    console.error(e);
  } finally {
    showLoader(false);
  }
});

// Manual Stock Adjustment
function triggerAdjustment(id) {
  const p = productsCache.find(x => x.id === id);
  if (!p) return;
  
  $('adjProductId').value = p.id;
  $('adjProductName').textContent = `${p.name} (${p.sku})`;
  $('adjCurrentQty').textContent = `${format.qty(p.on_hand_qty)} ${p.unit_of_measure}`;
  $('adjNewQty').value = '';
  $('adjCost').value = p.cost_price;
  $('adjNotes').value = '';
  
  openModal('modalAdjustment');
}

$('adjustmentForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('adjProductId').value;
  const payload = {
    quantity: parseFloat($('adjNewQty').value),
    reason: $('adjNotes').value.trim()
  };
  
  if (isNaN(payload.quantity)) {
    toast('Please enter a valid quantity delta', 'error');
    return;
  }
  
  showLoader(true);
  try {
    await apiFetch(`/api/products/${id}/adjust-stock`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    toast('Stock adjusted successfully');
    closeModal('modalAdjustment');
    loadProducts();
  } catch (err) {
    console.error(err);
  } finally {
    showLoader(false);
  }
});


// ── Customer & Vendor Parties Logic ──────────────────────────────────────
let partiesCache = [];
async function loadParties() {
  showLoader(true);
  try {
    const role = $('partyRoleFilter').value;
    const search = $('partySearch').value.trim();
    
    const params = new URLSearchParams();
    if (role) params.set('role', role);
    if (search) params.set('search', search);

    const list = await apiFetch(`/api/parties?${params.toString()}`);
    partiesCache = list;

    const tbody = $('partiesTable');
    tbody.innerHTML = '';
    
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted p-4">No customers or vendors match current criteria.</td></tr>';
      return;
    }

    list.forEach(p => {
      let roleBadge = '';
      if (p.is_vendor && p.is_customer) roleBadge = buildBadge('both');
      else if (p.is_vendor) roleBadge = buildBadge('vendor');
      else roleBadge = buildBadge('customer');

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="mono">${p.party_code || '—'}</span></td>
        <td><strong>${p.name}</strong></td>
        <td>${roleBadge}</td>
        <td><span class="mono">${p.gstin || '—'}</span></td>
        <td>${p.phone || '—'}</td>
        <td>${p.email || '—'}</td>
        <td style="max-width:220px; overflow:hidden; text-overflow:ellipsis;">${p.address || ''}, ${p.city || ''}</td>
        <td>
          <button class="btn btn-secondary btn-xs" onclick="editParty('${p.id}')">Edit</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (e) {
    console.error(e);
  } finally {
    showLoader(false);
  }
}

$('partyRoleFilter').addEventListener('change', loadParties);
$('partySearch').addEventListener('input', debounce(loadParties, 350));

$('btnAddParty').addEventListener('click', () => {
  $('partyForm').reset();
  $('partyId').value = '';
  $('modalPartyTitle').textContent = 'Create Contact Account';
  openModal('modalParty');
});

async function editParty(id) {
  const p = partiesCache.find(x => x.id === id);
  if (!p) return;
  
  $('partyId').value = p.id;
  $('ptName').value = p.name;
  $('ptIsCustomer').checked = p.is_customer;
  $('ptIsVendor').checked = p.is_vendor;
  $('ptGstin').value = p.gstin || '';
  $('ptPhone').value = p.phone || '';
  $('ptEmail').value = p.email || '';
  $('ptAddress').value = p.address || '';
  $('ptCity').value = p.city || '';
  $('ptState').value = p.state || '';
  $('ptPincode').value = p.pincode || '';
  
  $('modalPartyTitle').textContent = 'Edit Contact Details';
  openModal('modalParty');
}

$('partyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('partyId').value;
  const payload = {
    name: $('ptName').value.trim(),
    is_customer: $('ptIsCustomer').checked,
    is_vendor: $('ptIsVendor').checked,
    gstin: $('ptGstin').value.trim() || null,
    phone: $('ptPhone').value.trim() || null,
    email: $('ptEmail').value.trim() || null,
    address: $('ptAddress').value.trim() || null,
    city: $('ptCity').value.trim() || null,
    state: $('ptState').value.trim() || null,
    pincode: $('ptPincode').value.trim() || null
  };

  if (!payload.is_customer && !payload.is_vendor) {
    toast('Account must be configured as customer, supplier, or both', 'error');
    return;
  }

  showLoader(true);
  try {
    if (id) {
      await apiFetch(`/api/parties/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      toast('Contact account saved');
    } else {
      await apiFetch('/api/parties', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      toast('Contact account registered');
    }
    closeModal('modalParty');
    loadParties();
  } catch (err) {
    console.error(err);
  } finally {
    showLoader(false);
  }
});


// ── Sales Orders logic ────────────────────────────────────────────────────
let salesCache = [];
async function loadSalesOrders() {
  showLoader(true);
  try {
    const status = $('soStatusFilter').value;
    const params = new URLSearchParams();
    if (status) params.set('status', status);

    const res = await apiFetch(`/api/sales?${params.toString()}`);
    salesCache = res.data || [];

    const tbody = $('salesTable');
    tbody.innerHTML = '';
    
    if (salesCache.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted p-4">No sales orders found.</td></tr>';
      return;
    }

    salesCache.forEach(so => {
      let actionButtons = '';
      
      if (so.status === 'draft') {
        actionButtons += `<button class="btn btn-primary btn-xs" onclick="confirmSalesOrder('${so.id}')">Confirm</button>`;
        actionButtons += `<button class="btn btn-secondary btn-xs" onclick="editSalesOrderVoucher('${so.id}')">Edit</button>`;
        actionButtons += `<button class="btn btn-danger btn-xs" onclick="cancelSalesOrder('${so.id}')">Cancel</button>`;
      } else if (so.status === 'confirmed') {
        actionButtons += `<button class="btn btn-secondary btn-xs" onclick="paySalesOrder('${so.id}')">Process Pay</button>`;
        actionButtons += `<button class="btn btn-secondary btn-xs" onclick="triggerDeliveryModal('${so.id}')">Deliver Goods</button>`;
        actionButtons += `<button class="btn btn-danger btn-xs" onclick="cancelSalesOrder('${so.id}')">Cancel</button>`;
      } else if (so.status === 'payment_pending') {
        actionButtons += `<button class="btn btn-primary btn-xs" onclick="paySalesOrder('${so.id}')">Process Pay</button>`;
        actionButtons += `<button class="btn btn-secondary btn-xs" onclick="triggerDeliveryModal('${so.id}')">Deliver Goods</button>`;
      } else if (so.status === 'payment_done' || so.status === 'partially_delivered') {
        actionButtons += `<button class="btn btn-secondary btn-xs" onclick="triggerDeliveryModal('${so.id}')">Deliver Goods</button>`;
      }

      const payBadge = buildBadge(so.payment_status === 'paid' ? 'paid' : so.payment_status === 'pending' ? 'payment_pending' : 'unpaid');

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="mono">${so.order_number}</span></td>
        <td>
          <strong>${so.customer_name}</strong><br>
          <small class="text-muted">${so.party_code}</small>
        </td>
        <td style="text-align:center">${so.line_count}</td>
        <td><strong>${format.currency(so.total_amount)}</strong></td>
        <td>${format.date(so.order_date)}</td>
        <td>${format.date(so.expected_delivery)}</td>
        <td>${payBadge}</td>
        <td>${buildBadge(so.status)}</td>
        <td><div class="btn-row-actions">${actionButtons || '—'}</div></td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error(err);
  } finally {
    showLoader(false);
  }
}

$('soStatusFilter').addEventListener('change', loadSalesOrders);

// Sales order creator setup
$('btnCreateSalesOrder').addEventListener('click', async () => {
  $('salesOrderForm').reset();
  $('soLineRows').innerHTML = '';
  $('soEstimatedTotal').textContent = '₹0.00';
  
  // Populate customer dropdown
  const select = $('soCustomer');
  select.innerHTML = '<option value="">-- Select Customer Account --</option>';
  const customers = await apiFetch('/api/parties?role=customer');
  customers.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${c.name} (${c.party_code})`;
    select.appendChild(opt);
  });

  // Cache catalog for row additions
  if (productsCache.length === 0) {
    const res = await apiFetch('/api/products?limit=100');
    productsCache = res.data || [];
  }

  // Create first empty line
  addSalesOrderLineRow();
  openModal('modalSalesOrder');
});

$('btnSoAddLine').addEventListener('click', addSalesOrderLineRow);

function addSalesOrderLineRow() {
  const tbody = $('soLineRows');
  const index = tbody.children.length;
  const tr = document.createElement('tr');
  
  // Finished goods option elements
  const productOptions = productsCache
    .filter(p => p.product_type === 'finished_good')
    .map(p => `<option value="${p.id}" data-price="${p.sales_price}">${p.name} (${p.sku}) — stock: ${p.free_to_use_qty}</option>`)
    .join('');

  tr.innerHTML = `
    <td>
      <select class="line-product" required onchange="onSoProductChange(this)">
        <option value="">-- Select Product --</option>
        ${productOptions}
      </select>
    </td>
    <td>
      <input type="number" class="line-qty" min="1" step="1" required value="1" oninput="recalcSoTotals()">
    </td>
    <td>
      <input type="number" class="line-price" min="0" step="0.01" required value="0.00" oninput="recalcSoTotals()">
    </td>
    <td>
      <span class="line-total mono font-weight-bold">₹0.00</span>
    </td>
    <td>
      <button type="button" class="btn btn-danger btn-xs" onclick="removeLineRow(this, recalcSoTotals)">&times;</button>
    </td>
  `;
  tbody.appendChild(tr);
}

function onSoProductChange(select) {
  const opt = select.options[select.selectedIndex];
  const price = opt.dataset.price || 0;
  const row = select.closest('tr');
  row.querySelector('.line-price').value = parseFloat(price).toFixed(2);
  recalcSoTotals();
}

function removeLineRow(btn, recalcFn) {
  const row = btn.closest('tr');
  row.parentNode.removeChild(row);
  recalcFn();
}

function recalcSoTotals() {
  let total = 0;
  document.querySelectorAll('#soLineRows tr').forEach(row => {
    const qty = parseFloat(row.querySelector('.line-qty').value) || 0;
    const price = parseFloat(row.querySelector('.line-price').value) || 0;
    const lineTotal = qty * price;
    row.querySelector('.line-total').textContent = format.currency(lineTotal);
    total += lineTotal;
  });
  $('soEstimatedTotal').textContent = format.currency(total);
}

// Sales Order Form Submit
$('salesOrderForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const customerId = $('soCustomer').value;
  const deliveryDate = $('soDeliveryDate').value;
  const address = $('soAddress').value.trim();
  const notes = $('soNotes').value.trim();
  
  const lines = [];
  document.querySelectorAll('#soLineRows tr').forEach(row => {
    lines.push({
      product_id: row.querySelector('.line-product').value,
      quantity: parseFloat(row.querySelector('.line-qty').value),
      unit_price: parseFloat(row.querySelector('.line-price').value)
    });
  });

  if (lines.length === 0) {
    toast('At least one item line is required', 'error');
    return;
  }

  showLoader(true);
  try {
    await apiFetch('/api/sales', {
      method: 'POST',
      body: JSON.stringify({
        customer_party_id: customerId,
        expected_delivery: deliveryDate,
        shipping_address: address,
        notes,
        lines
      })
    });
    toast('Sales Order Created');
    closeModal('modalSalesOrder');
    loadSalesOrders();
  } catch (err) {
    console.error(err);
  } finally {
    showLoader(false);
  }
});

// Confirm Sales Order
async function confirmSalesOrder(id) {
  showLoader(true);
  try {
    const result = await apiFetch(`/api/sales/${id}/confirm`, { method: 'POST' });
    toast('Sales Order confirmed successfully');
    
    // Check if any procurement items were automatically scheduled
    if (result.procurement && result.procurement.length > 0) {
      toast(`Auto-procurement scheduled: created ${result.procurement.length} supply orders`, 'info');
    }
    
    loadSalesOrders();
  } catch (err) {
    console.error(err);
  } finally {
    showLoader(false);
  }
}

// Cancel Sales Order
async function cancelSalesOrder(id) {
  if (!confirm('Are you sure you want to cancel this sales order? Any reserved inventory will be released.')) return;
  showLoader(true);
  try {
    await apiFetch(`/api/sales/${id}/cancel`, { method: 'POST' });
    toast('Sales Order cancelled');
    loadSalesOrders();
  } catch (e) {
    console.error(e);
  } finally {
    showLoader(false);
  }
}

// Razorpay checkout integration
async function paySalesOrder(id) {
  showLoader(true);
  try {
    const orderData = await apiFetch('/api/payments/create', {
      method: 'POST',
      body: JSON.stringify({ sales_order_id: id })
    });

    if (!orderData) return;

    const options = {
      key: orderData.key_id,
      amount: orderData.amount,
      currency: orderData.currency,
      name: 'Mini ERP',
      description: `Sales Order Payment`,
      order_id: orderData.razorpay_order_id,
      handler: async function (response) {
        showLoader(true);
        try {
          await apiFetch('/api/payments/verify', {
            method: 'POST',
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              sales_order_id: id
            })
          });
          toast('Payment completed successfully!');
          loadSalesOrders();
        } catch (err) {
          toast('Payment verification failed', 'error');
        } finally {
          showLoader(false);
        }
      },
      prefill: {
        name: currentUser.full_name,
        email: currentUser.email
      },
      theme: { color: '#1A56DB' }
    };

    const rzp = new Razorpay(options);
    rzp.on('payment.failed', function (response){
      toast('Payment checkout transaction failed: ' + response.error.description, 'error');
    });
    rzp.open();

  } catch (err) {
    console.error(err);
  } finally {
    showLoader(false);
  }
}

// Delivery Dispatch Modal
async function triggerDeliveryModal(id) {
  showLoader(true);
  try {
    const so = await apiFetch(`/api/sales/${id}`);
    $('delSoId').value = so.id;
    $('delOrderNum').textContent = so.order_number;
    
    const tbody = $('delLineRows');
    tbody.innerHTML = '';
    
    so.lines.forEach(l => {
      const remaining = parseFloat(l.quantity) - parseFloat(l.delivered_qty);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <strong>${l.product_name}</strong><br>
          <small class="text-muted">${l.sku}</small>
        </td>
        <td class="mono text-center">${format.qty(l.quantity)}</td>
        <td class="mono text-center">${format.qty(l.delivered_qty)}</td>
        <td>
          <input type="number" class="del-qty-input" data-line-id="${l.id}" min="0" max="${remaining}" step="0.01" value="${remaining}" style="padding: 6px; font-size:12px;">
        </td>
      `;
      tbody.appendChild(tr);
    });
    
    openModal('modalSoDeliver');
  } catch (err) {
    console.error(err);
  } finally {
    showLoader(false);
  }
}

$('soDeliverForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('delSoId').value;
  const deliveries = [];
  document.querySelectorAll('#delLineRows tr').forEach(row => {
    const input = row.querySelector('.del-qty-input');
    deliveries.push({
      line_id: input.dataset.lineId,
      qty: parseFloat(input.value) || 0
    });
  });

  showLoader(true);
  try {
    await apiFetch(`/api/sales/${id}/deliver`, {
      method: 'POST',
      body: JSON.stringify({ deliveries })
    });
    toast('Shipment delivery processed');
    closeModal('modalSoDeliver');
    loadSalesOrders();
  } catch (e) {
    console.error(e);
  } finally {
    showLoader(false);
  }
});


// ── Purchase Orders logic ─────────────────────────────────────────────────
let purchaseCache = [];
async function loadPurchaseOrders() {
  showLoader(true);
  try {
    const status = $('poStatusFilter').value;
    const params = new URLSearchParams();
    if (status) params.set('status', status);

    const res = await apiFetch(`/api/purchase?${params.toString()}`);
    purchaseCache = res.data || [];

    const tbody = $('purchasesTable');
    tbody.innerHTML = '';
    
    if (purchaseCache.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted p-4">No purchase orders found.</td></tr>';
      return;
    }

    purchaseCache.forEach(po => {
      let actionButtons = '';
      if (po.status === 'draft') {
        actionButtons += `<button class="btn btn-primary btn-xs" onclick="confirmPurchaseOrder('${po.id}')">Confirm</button>`;
      } else if (po.status === 'confirmed' || po.status === 'partially_received') {
        actionButtons += `<button class="btn btn-secondary btn-xs" onclick="triggerReceiveModal('${po.id}')">Inward Receipts</button>`;
      }

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="mono">${po.order_number}</span></td>
        <td>
          <strong>${po.vendor_name}</strong><br>
          <small class="text-muted">${po.vendor_code}</small>
        </td>
        <td style="text-align:center">${po.line_count}</td>
        <td><strong>${format.currency(po.total_amount)}</strong></td>
        <td>${format.date(po.order_date)}</td>
        <td>${format.date(po.expected_receipt)}</td>
        <td>${buildBadge(po.status)}</td>
        <td><div class="btn-row-actions">${actionButtons || '—'}</div></td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error(err);
  } finally {
    showLoader(false);
  }
}

$('poStatusFilter').addEventListener('change', loadPurchaseOrders);

// Purchase order creator setup
$('btnCreatePurchaseOrder').addEventListener('click', async () => {
  $('purchaseOrderForm').reset();
  $('poLineRows').innerHTML = '';
  $('poEstimatedTotal').textContent = '₹0.00';
  
  // Populate vendor select
  const select = $('poVendor');
  select.innerHTML = '<option value="">-- Select Vendor Account --</option>';
  const vendors = await apiFetch('/api/parties?role=vendor');
  vendors.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = `${v.name} (${v.party_code})`;
    select.appendChild(opt);
  });

  // Cache catalog
  if (productsCache.length === 0) {
    const res = await apiFetch('/api/products?limit=100');
    productsCache = res.data || [];
  }

  // Create first line
  addPurchaseOrderLineRow();
  openModal('modalPurchaseOrder');
});

$('btnPoAddLine').addEventListener('click', addPurchaseOrderLineRow);

function addPurchaseOrderLineRow() {
  const tbody = $('poLineRows');
  const tr = document.createElement('tr');
  
  // Raw materials or components select list options
  const productOptions = productsCache
    .filter(p => p.product_type === 'raw_material' || p.product_type === 'component')
    .map(p => `<option value="${p.id}" data-price="${p.cost_price}">${p.name} (${p.sku})</option>`)
    .join('');

  tr.innerHTML = `
    <td>
      <select class="line-product" required onchange="onPoProductChange(this)">
        <option value="">-- Select Item --</option>
        ${productOptions}
      </select>
    </td>
    <td>
      <input type="number" class="line-qty" min="1" step="1" required value="1" oninput="recalcPoTotals()">
    </td>
    <td>
      <input type="number" class="line-price" min="0" step="0.01" required value="0.00" oninput="recalcPoTotals()">
    </td>
    <td>
      <span class="line-total mono font-weight-bold">₹0.00</span>
    </td>
    <td>
      <button type="button" class="btn btn-danger btn-xs" onclick="removeLineRow(this, recalcPoTotals)">&times;</button>
    </td>
  `;
  tbody.appendChild(tr);
}

function onPoProductChange(select) {
  const opt = select.options[select.selectedIndex];
  const price = opt.dataset.price || 0;
  const row = select.closest('tr');
  row.querySelector('.line-price').value = parseFloat(price).toFixed(2);
  recalcPoTotals();
}

function recalcPoTotals() {
  let total = 0;
  document.querySelectorAll('#poLineRows tr').forEach(row => {
    const qty = parseFloat(row.querySelector('.line-qty').value) || 0;
    const price = parseFloat(row.querySelector('.line-price').value) || 0;
    const lineTotal = qty * price;
    row.querySelector('.line-total').textContent = format.currency(lineTotal);
    total += lineTotal;
  });
  $('poEstimatedTotal').textContent = format.currency(total);
}

// Purchase Form Submission
$('purchaseOrderForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const vendorId = $('poVendor').value;
  const receiptDate = $('poReceiptDate').value;
  const notes = $('poNotes').value.trim();
  
  const lines = [];
  document.querySelectorAll('#poLineRows tr').forEach(row => {
    lines.push({
      product_id: row.querySelector('.line-product').value,
      quantity: parseFloat(row.querySelector('.line-qty').value),
      unit_price: parseFloat(row.querySelector('.line-price').value)
    });
  });

  if (lines.length === 0) {
    toast('At least one item line is required', 'error');
    return;
  }

  showLoader(true);
  try {
    await apiFetch('/api/purchase', {
      method: 'POST',
      body: JSON.stringify({
        vendor_party_id: vendorId,
        expected_receipt: receiptDate,
        notes,
        lines
      })
    });
    toast('Purchase Order Drafted');
    closeModal('modalPurchaseOrder');
    loadPurchaseOrders();
  } catch (err) {
    console.error(err);
  } finally {
    showLoader(false);
  }
});

async function confirmPurchaseOrder(id) {
  showLoader(true);
  try {
    await apiFetch(`/api/purchase/${id}/confirm`, { method: 'POST' });
    toast('Purchase Order Confirmed');
    loadPurchaseOrders();
  } catch (e) {
    console.error(e);
  } finally {
    showLoader(false);
  }
}

// PO Goods Receipt Inward
async function triggerReceiveModal(id) {
  showLoader(true);
  try {
    const po = await apiFetch(`/api/purchase/${id}`);
    $('recPoId').value = po.id;
    $('recOrderNum').textContent = po.order_number;
    
    const tbody = $('recLineRows');
    tbody.innerHTML = '';
    
    po.lines.forEach(l => {
      const remaining = parseFloat(l.quantity) - parseFloat(l.received_qty);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <strong>${l.product_name}</strong><br>
          <small class="text-muted">${l.sku}</small>
        </td>
        <td class="mono text-center">${format.qty(l.quantity)}</td>
        <td class="mono text-center">${format.qty(l.received_qty)}</td>
        <td>
          <input type="number" class="rec-qty-input" data-line-id="${l.id}" min="0" max="${remaining}" step="0.01" value="${remaining}" style="padding: 6px; font-size:12px;">
        </td>
      `;
      tbody.appendChild(tr);
    });
    
    openModal('modalPoReceive');
  } catch (err) {
    console.error(err);
  } finally {
    showLoader(false);
  }
}

$('poReceiveForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('recPoId').value;
  const receipts = [];
  document.querySelectorAll('#recLineRows tr').forEach(row => {
    const input = row.querySelector('.rec-qty-input');
    receipts.push({
      line_id: input.dataset.lineId,
      qty: parseFloat(input.value) || 0
    });
  });

  showLoader(true);
  try {
    await apiFetch(`/api/purchase/${id}/receive`, {
      method: 'POST',
      body: JSON.stringify({ receipts })
    });
    toast('Goods receipt processed successfully');
    closeModal('modalPoReceive');
    loadPurchaseOrders();
  } catch (err) {
    console.error(err);
  } finally {
    showLoader(false);
  }
});


// ── Manufacturing Orders logic ────────────────────────────────────────────
let mfgCache = [];
async function loadManufacturing() {
  showLoader(true);
  try {
    const status = $('moStatusFilter').value;
    const params = new URLSearchParams();
    if (status) params.set('status', status);

    const res = await apiFetch(`/api/manufacturing?${params.toString()}`);
    mfgCache = res.data || [];

    const tbody = $('mfgTable');
    tbody.innerHTML = '';
    
    if (mfgCache.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted p-4">No manufacturing orders scheduled.</td></tr>';
      return;
    }

    mfgCache.forEach(mo => {
      let actionButtons = '';
      
      if (mo.status === 'draft') {
        actionButtons += `<button class="btn btn-primary btn-xs" onclick="confirmMfgOrder('${mo.id}')">Confirm</button>`;
      } else if (mo.status === 'confirmed') {
        actionButtons += `<button class="btn btn-primary btn-xs" onclick="startMfgOrder('${mo.id}')">Start Production</button>`;
      } else if (mo.status === 'in_progress' || mo.status === 'partially_produced') {
        actionButtons += `<button class="btn btn-secondary btn-xs" onclick="triggerMoOpsModal('${mo.id}')">Track Routing</button>`;
        actionButtons += `<button class="btn btn-primary btn-xs" onclick="triggerCompleteMoModal('${mo.id}')">Complete MO</button>`;
      }

      const progress = progressBar(mo.produced_qty, mo.quantity);

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="mono">${mo.order_number}</span></td>
        <td>
          <strong>${mo.product_name}</strong><br>
          <small class="text-muted">${mo.sku}</small>
        </td>
        <td>${mo.bom_name || '—'}</td>
        <td class="qty-neutral">${format.qty(mo.quantity)}</td>
        <td class="qty-positive">${format.qty(mo.produced_qty)}</td>
        <td>${progress}</td>
        <td>${buildBadge(mo.priority)}</td>
        <td>${buildBadge(mo.status)}</td>
        <td><div class="btn-row-actions">${actionButtons || '—'}</div></td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error(err);
  } finally {
    showLoader(false);
  }
}

$('moStatusFilter').addEventListener('change', loadManufacturing);

function progressBar(val, max) {
  const pct = max > 0 ? Math.min(100, Math.round((val / max) * 100)) : 0;
  return `
    <div class="progress-wrap">
      <div class="progress-bar-bg"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
      <span class="progress-pct">${pct}%</span>
    </div>`;
}

// Create Manufacturing Order
$('btnCreateMfgOrder').addEventListener('click', async () => {
  $('mfgOrderForm').reset();
  
  // Populate finished products
  const selectProd = $('moProduct');
  selectProd.innerHTML = '<option value="">-- Select Finished Product --</option>';
  
  if (productsCache.length === 0) {
    const res = await apiFetch('/api/products?limit=100');
    productsCache = res.data || [];
  }
  
  productsCache
    .filter(p => p.product_type === 'finished_good')
    .forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.name} (${p.sku})`;
      selectProd.appendChild(opt);
    });

  // Populate Lead users
  const selectLead = $('moAssignee');
  selectLead.innerHTML = '<option value="">-- Select Employee Lead --</option>';
  const users = await apiFetch('/api/users');
  users.forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.id;
    opt.textContent = `${u.full_name} (${u.role.replace(/_/g, ' ')})`;
    selectLead.appendChild(opt);
  });

  // Handle product changes to load matching BOMs
  selectProd.onchange = async () => {
    const pId = selectProd.value;
    const selectBom = $('moBom');
    selectBom.innerHTML = '<option value="">-- Select Active BoM Recipe --</option>';
    if (!pId) return;
    
    const boms = await apiFetch(`/api/bom?product_id=${pId}`);
    boms.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = `${b.name} (Rev ${b.version})`;
      selectBom.appendChild(opt);
    });
  };

  openModal('modalMfgOrder');
});

$('mfgOrderForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    product_id: $('moProduct').value,
    bom_id: $('moBom').value,
    quantity: parseFloat($('moQty').value),
    priority: $('moPriority').value,
    planned_start: $('moPlannedStart').value || null,
    planned_end: $('moPlannedEnd').value || null,
    assignee_id: $('moAssignee').value || null,
    notes: $('moNotes').value.trim()
  };

  showLoader(true);
  try {
    await apiFetch('/api/manufacturing', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    toast('Manufacturing Order scheduled');
    closeModal('modalMfgOrder');
    loadManufacturing();
  } catch (err) {
    console.error(err);
  } finally {
    showLoader(false);
  }
});

async function confirmMfgOrder(id) {
  showLoader(true);
  try {
    await apiFetch(`/api/manufacturing/${id}/confirm`, { method: 'POST' });
    toast('MO confirmed successfully and raw materials reserved');
    loadManufacturing();
  } catch (e) { console.error(e); }
  finally { showLoader(false); }
}

async function startMfgOrder(id) {
  showLoader(true);
  try {
    await apiFetch(`/api/manufacturing/${id}/start`, { method: 'POST' });
    toast('Manufacturing Order started in shop floor');
    loadManufacturing();
  } catch (e) { console.error(e); }
  finally { showLoader(false); }
}

// Work Order routing triggers
let currentMoRouting = null;
async function triggerMoOpsModal(moId) {
  showLoader(true);
  try {
    const mo = await apiFetch(`/api/manufacturing/${moId}`);
    currentMoRouting = mo;
    
    $('mfgBannerOrderNum').textContent = mo.order_number;
    $('mfgBannerProductName').textContent = mo.product_name;
    $('mfgBannerQty').textContent = `${format.qty(mo.quantity)} units`;
    $('mfgBannerLead').textContent = mo.assignee_name || 'Unassigned';
    
    renderWorkOrdersList(mo.work_orders);
    openModal('modalMoOperations');
  } catch (e) { console.error(e); }
  finally { showLoader(false); }
}

function renderWorkOrdersList(wos) {
  const container = $('moOperationsGrid');
  container.innerHTML = '';
  
  if (wos.length === 0) {
    container.innerHTML = '<div class="text-center text-muted">No routing operations configured.</div>';
    return;
  }

  wos.forEach(wo => {
    const div = document.createElement('div');
    div.className = `operation-node ${wo.status === 'completed' ? 'completed' : ''}`;
    
    let btnText = '';
    let actionFn = '';
    if (wo.status === 'pending') {
      btnText = 'Start Operation';
      actionFn = `startWorkOrder('${wo.id}')`;
    } else if (wo.status === 'in_progress') {
      btnText = 'Complete Operation';
      actionFn = `completeWorkOrderPrompt('${wo.id}')`;
    }

    const controlButton = btnText ? `<button class="btn btn-secondary btn-sm" onclick="${actionFn}">${btnText}</button>` : buildBadge(wo.status);

    div.innerHTML = `
      <div class="op-details">
        <div class="op-name">Seq ${wo.sequence_order}: ${wo.operation_name}</div>
        <div class="op-meta">
          <span>Center: <strong>${wo.work_center_name || 'Manual'}</strong></span>
          <span>Time: <strong>${wo.planned_duration_min} min</strong></span>
          ${wo.actual_duration_min ? `<span>Actual: <strong>${wo.actual_duration_min} min</strong></span>` : ''}
        </div>
      </div>
      <div>${controlButton}</div>
    `;
    container.appendChild(div);
  });
}

async function startWorkOrder(woId) {
  showLoader(true);
  try {
    await apiFetch(`/api/manufacturing/work-orders/${woId}/start`, { method: 'POST' });
    toast('Work Order started');
    // Refresh modal
    triggerMoOpsModal(currentMoRouting.id);
    loadManufacturing();
  } catch (err) { console.error(err); }
  finally { showLoader(false); }
}

async function completeWorkOrderPrompt(woId) {
  const duration = prompt('Enter actual duration in minutes:', '30');
  if (duration === null) return;
  const notes = prompt('Enter operation notes (optional):', '');
  
  showLoader(true);
  try {
    const result = await apiFetch(`/api/manufacturing/work-orders/${woId}/complete`, {
      method: 'POST',
      body: JSON.stringify({
        actual_duration_min: parseInt(duration) || null,
        notes: notes || null
      })
    });
    toast('Work order completed');
    
    // Refresh routing view
    triggerMoOpsModal(currentMoRouting.id);
    loadManufacturing();
  } catch (err) { console.error(err); }
  finally { showLoader(false); }
}

function triggerCompleteMoModal(moId) {
  const mo = mfgCache.find(x => x.id === moId);
  if (!mo) return;
  
  const produced = prompt(`Verify quantity completed for ${mo.order_number}:`, mo.quantity);
  if (produced === null) return;
  
  showLoader(true);
  apiFetch(`/api/manufacturing/${moId}/complete`, {
    method: 'POST',
    body: JSON.stringify({ produced_qty: parseFloat(produced) })
  }).then(res => {
    toast('Manufacturing Order completed and stock updated!');
    loadManufacturing();
  }).catch(e => {
    console.error(e);
  }).finally(() => {
    showLoader(false);
  });
}


// ── Stock Movement Ledger logic ──────────────────────────────────────────
async function loadInventoryLedger() {
  showLoader(true);
  try {
    const type = $('movTypeFilter').value;
    const params = new URLSearchParams();
    if (type) params.set('type', type);

    const list = await apiFetch(`/api/inventory?${params.toString()}`);
    
    const tbody = $('inventoryTable');
    tbody.innerHTML = '';
    
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted p-4">No stock ledger entries.</td></tr>';
      return;
    }

    list.forEach(sl => {
      const isPositive = parseFloat(sl.quantity) >= 0;
      const qtyClass = isPositive ? 'qty-positive' : 'qty-negative';
      const qtySign = isPositive ? '+' : '';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <strong>${sl.product_name}</strong><br>
          <small class="text-muted">${sl.product_type.replace(/_/g, ' ')}</small>
        </td>
        <td><span class="mono">${sl.sku}</span></td>
        <td>${buildBadge(sl.movement_type)}</td>
        <td><span class="text-muted">${sl.reference_type.replace(/_/g, ' ')}</span></td>
        <td class="${qtyClass}">${qtySign}${format.qty(sl.quantity)}</td>
        <td>${sl.unit_cost ? format.currency(sl.unit_cost) : '—'}</td>
        <td class="qty-neutral">${format.qty(sl.running_balance)}</td>
        <td>${sl.created_by_name || 'System'}</td>
        <td>${format.datetime(sl.created_at)}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error(err);
  } finally {
    showLoader(false);
  }
}

$('movTypeFilter').addEventListener('change', loadInventoryLedger);


// ── Bill of Materials (BOM) logic ────────────────────────────────────────
let bomsCache = [];
async function loadBoms() {
  showLoader(true);
  try {
    const res = await apiFetch('/api/bom?active=all');
    bomsCache = res;
    
    const tbody = $('bomsTable');
    tbody.innerHTML = '';
    
    if (bomsCache.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted p-4">No recipe specifications found.</td></tr>';
      return;
    }

    bomsCache.forEach(b => {
      const activeText = b.is_active ? 'Active' : 'Inactive';
      const activeBadge = b.is_active ? buildBadge('paid') : buildBadge('cancelled');

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${b.name}</strong></td>
        <td>${b.product_name}</td>
        <td><span class="mono">${b.sku}</span></td>
        <td style="text-align:center">${b.version}</td>
        <td style="text-align:center"><span class="qty-positive">${b.component_count}</span></td>
        <td style="text-align:center"><span class="qty-neutral">${b.operation_count}</span></td>
        <td>${activeBadge}</td>
        <td>${format.date(b.created_at)}</td>
        <td>
          <button class="btn btn-secondary btn-xs" onclick="deactivateBom('${b.id}')" ${!b.is_active ? 'disabled' : ''}>Deactivate</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error(err);
  } finally {
    showLoader(false);
  }
}

async function deactivateBom(id) {
  if (!confirm('Are you sure you want to deactivate this BoM specification?')) return;
  showLoader(true);
  try {
    await apiFetch(`/api/bom/${id}`, { method: 'DELETE' });
    toast('BoM Deactivated');
    loadBoms();
  } catch (e) { console.error(e); }
  finally { showLoader(false); }
}

// Create BOM setup
$('btnCreateBom').addEventListener('click', async () => {
  $('bomForm').reset();
  $('bomComponentRows').innerHTML = '';
  $('bomOperationRows').innerHTML = '';
  
  if (productsCache.length === 0) {
    const res = await apiFetch('/api/products?limit=100');
    productsCache = res.data || [];
  }

  // Populate finished products
  const selectProd = $('bomProduct');
  selectProd.innerHTML = '<option value="">-- Select Finished Product --</option>';
  productsCache
    .filter(p => p.product_type === 'finished_good' || p.product_type === 'component')
    .forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.name} (${p.sku})`;
      selectProd.appendChild(opt);
    });

  // Load work centers
  const wcRes = await apiFetch('/api/work-centers');
  cache.workCenters = wcRes;

  addBomComponentRow();
  addBomOperationRow();
  openModal('modalBom');
});

$('btnBomAddComponent').addEventListener('click', addBomComponentRow);
$('btnBomAddOperation').addEventListener('click', addBomOperationRow);

function addBomComponentRow() {
  const tbody = $('bomComponentRows');
  const tr = document.createElement('tr');
  
  // Component options
  const options = productsCache
    .filter(p => p.product_type === 'raw_material' || p.product_type === 'component')
    .map(p => `<option value="${p.id}">${p.name} (${p.sku})</option>`)
    .join('');

  tr.innerHTML = `
    <td>
      <select class="bom-comp-id" required>
        <option value="">-- Select Component --</option>
        ${options}
      </select>
    </td>
    <td>
      <input type="number" class="bom-comp-qty" min="0.0001" step="0.0001" required value="1">
    </td>
    <td>
      <button type="button" class="btn btn-danger btn-xs" onclick="removeLineRow(this, () => {})">&times;</button>
    </td>
  `;
  tbody.appendChild(tr);
}

function addBomOperationRow() {
  const tbody = $('bomOperationRows');
  const tr = document.createElement('tr');
  
  const wcOptions = (cache.workCenters || [])
    .map(w => `<option value="${w.id}">${w.name}</option>`)
    .join('');

  tr.innerHTML = `
    <td>
      <input type="text" class="bom-op-name" required placeholder="Cutting Wood...">
    </td>
    <td>
      <select class="bom-op-wc" required>
        <option value="">-- Select Station --</option>
        ${wcOptions}
      </select>
    </td>
    <td>
      <input type="number" class="bom-op-dur" min="1" required value="30" placeholder="Duration">
    </td>
    <td>
      <button type="button" class="btn btn-danger btn-xs" onclick="removeLineRow(this, () => {})">&times;</button>
    </td>
  `;
  tbody.appendChild(tr);
}

$('bomForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const product_id = $('bomProduct').value;
  const name = $('bomName').value.trim();
  const version = parseInt($('bomVersion').value) || 1;
  const quantity = parseFloat($('bomQty').value) || 1;
  const notes = $('bomNotes').value.trim();

  const components = [];
  document.querySelectorAll('#bomComponentRows tr').forEach(row => {
    components.push({
      component_id: row.querySelector('.bom-comp-id').value,
      quantity: parseFloat(row.querySelector('.bom-comp-qty').value)
    });
  });

  const operations = [];
  document.querySelectorAll('#bomOperationRows tr').forEach(row => {
    operations.push({
      operation_name: row.querySelector('.bom-op-name').value.trim(),
      work_center_id: row.querySelector('.bom-op-wc').value,
      duration_minutes: parseInt(row.querySelector('.bom-op-dur').value)
    });
  });

  if (components.length === 0) {
    toast('At least one component is required in recipe', 'error');
    return;
  }

  showLoader(true);
  try {
    await apiFetch('/api/bom', {
      method: 'POST',
      body: JSON.stringify({
        product_id, name, version, quantity, notes, components, operations
      })
    });
    toast('Bill of Materials drafted');
    closeModal('modalBom');
    loadBoms();
  } catch (err) {
    console.error(err);
  } finally {
    showLoader(false);
  }
});


// ── User Access System logic ──────────────────────────────────────────────
let usersCache = [];
async function loadUsers() {
  showLoader(true);
  try {
    const list = await apiFetch('/api/users');
    usersCache = list;
    
    const tbody = $('usersTable');
    tbody.innerHTML = '';
    
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted p-4">No users found.</td></tr>';
      return;
    }

    list.forEach(u => {
      const activeText = u.is_active ? 'Active' : 'Deactivated';
      const activeBadge = u.is_active ? buildBadge('paid') : buildBadge('cancelled');

      // Map rights modules
      const mods = (u.access_rights || [])
        .map(ar => `${ar.module} (${ar.access_type})`)
        .join(', ');

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="mono">${u.login_id}</span></td>
        <td><strong>${u.full_name}</strong></td>
        <td>${buildBadge(u.role)}</td>
        <td><span class="text-muted">${u.email}</span></td>
        <td style="max-width:240px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${mods}">${mods || '—'}</td>
        <td>${activeBadge}</td>
        <td>
          <div class="btn-row-actions">
            <button class="btn btn-primary btn-xs" onclick="editUser('${u.id}')">Edit / Manage</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (e) {
    console.error(e);
  } finally {
    showLoader(false);
  }
}

async function deactivateUser(id) {
  if (!confirm('Are you sure you want to deactivate this user account?')) return;
  showLoader(true);
  try {
    await apiFetch(`/api/users/${id}`, { method: 'DELETE' });
    toast('User Deactivated');
    loadUsers();
  } catch (err) { console.error(err); }
  finally { showLoader(false); }
}

async function editUser(id) {
  const u = usersCache.find(x => x.id === id);
  if (!u) return;

  $('uId').value = u.id;
  $('uLoginId').value = u.login_id;
  $('uLoginId').disabled = true;
  $('uFullName').value = u.full_name;
  $('uEmail').value = u.email;
  $('uEmailGroup').style.display = 'none';
  $('uPassword').value = '';
  $('uPassword').required = false;
  $('uPasswordLabel').textContent = 'New Password (optional)';
  $('uRole').value = u.role;
  if (u.id === currentUser.id) {
    $('uActiveGroup').style.display = 'none';
  } else {
    $('uActiveGroup').style.display = 'block';
    $('uActive').value = u.is_active.toString();
  }

  $('modalUserTitle').textContent = 'Edit Corporate User Account';
  $('btnUserSubmit').textContent = 'Save Changes';
  openModal('modalUser');
}

$('btnCreateUser').addEventListener('click', () => {
  $('userForm').reset();
  $('uId').value = '';
  $('uLoginId').disabled = false;
  $('uEmailGroup').style.display = 'block';
  $('uPassword').required = true;
  $('uPasswordLabel').textContent = 'Password *';
  $('uActiveGroup').style.display = 'none';
  $('modalUserTitle').textContent = 'Register Corporate User Account';
  $('btnUserSubmit').textContent = 'Register User';
  openModal('modalUser');
});

$('userForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const id = $('uId').value;
  const login_id = $('uLoginId').value.trim();
  const full_name = $('uFullName').value.trim();
  const email = $('uEmail').value.trim();
  const password = $('uPassword').value;
  const role = $('uRole').value;
  
  let is_active = true;
  if (id) {
    const existing = usersCache.find(x => x.id === id);
    if (existing && existing.id === currentUser.id) {
      is_active = existing.is_active;
    } else {
      is_active = $('uActive').value === 'true';
    }
  }

  // Set default modules access maps based on role
  let access_rights = [];
  const modules = ['products','sales','purchase','manufacturing','bom','inventory','audit_logs','users'];
  modules.forEach(mod => {
    let type = 'none';
    if (role === 'admin') type = 'admin';
    else if (role === 'business_owner') type = 'user';
    else if (role === 'sales_user' && ['sales','inventory','products'].includes(mod)) type = 'user';
    else if (role === 'purchase_user' && ['purchase','inventory','products','sales'].includes(mod)) type = 'user';
    else if (role === 'manufacturing_user' && ['manufacturing','bom','inventory'].includes(mod)) type = 'user';
    else if (role === 'inventory_manager' && ['inventory','products'].includes(mod)) type = 'admin';
    else if (role === 'inventory_manager') type = 'user';
    
    access_rights.push({ module: mod, access_type: type });
  });

  showLoader(true);
  try {
    if (id) {
      await apiFetch(`/api/users/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          full_name, role, is_active, password: password || undefined, access_rights
        })
      });
      toast('User account updated successfully');
    } else {
      await apiFetch('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          login_id, full_name, email, password, role, access_rights
        })
      });
      toast('User Registered Successfully');
    }
    closeModal('modalUser');
    loadUsers();
  } catch (err) {
    console.error(err);
  } finally {
    showLoader(false);
  }
});


// ── Audit Trail logic ────────────────────────────────────────────────────
async function loadAuditLogs() {
  showLoader(true);
  try {
    const list = await apiFetch('/api/analytics/audit-logs');
    
    const tbody = $('auditTable');
    tbody.innerHTML = '';
    
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted p-4">No audit logs recorded.</td></tr>';
      return;
    }

    list.forEach(a => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="mono">${a.table_name}</span></td>
        <td><span class="mono text-muted">${a.record_id ? a.record_id.slice(0,8)+'...' : '—'}</span></td>
        <td>${buildBadge(a.action)}</td>
        <td><strong>${a.user_name || 'System'}</strong></td>
        <td><span class="mono text-muted">${a.ip_address || '—'}</span></td>
        <td style="max-width:320px; overflow:hidden; text-overflow:ellipsis;" title="${a.description}">${a.description || '—'}</td>
        <td>${format.datetime(a.created_at)}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (e) {
    console.error(e);
  } finally {
    showLoader(false);
  }
}


// ── ServiceNow Elevate Role & Service Desk Features ──────────────────────────
let incidentsCache = [];
let currentIncident = null;
let activeIncidentTimelineType = 'comment'; // 'comment' or 'work_note'
let slaInterval = null;

// Toggles active tab under incident timeline stream (Work Notes vs Customer Comments)
function setTimelineUpdateType(type) {
  activeIncidentTimelineType = type;
  const btnComment = $('btnToggleComment');
  const btnWorknote = $('btnToggleWorknote');
  const textarea = $('incDetailNewUpdateText');
  
  if (type === 'comment') {
    if (btnComment) btnComment.classList.add('active');
    if (btnWorknote) btnWorknote.classList.remove('active');
    if (textarea) textarea.placeholder = 'Type a comment visible to callers...';
  } else {
    if (btnComment) btnComment.classList.remove('active');
    if (btnWorknote) btnWorknote.classList.add('active');
    if (textarea) textarea.placeholder = 'Type an internal work note (visible to staff only)...';
  }
}

// Loads incidents from the server and populates the list view
async function loadIncidents() {
  showLoader(true);
  try {
    const dept = $('incidentDeptFilter').value;
    const priority = $('incidentPriorityFilter').value;
    const search = $('incidentSearch').value.toLowerCase().trim();

    const list = await apiFetch('/api/incidents');
    incidentsCache = list || [];

    // Filter list
    let filtered = list;
    if (dept) {
      filtered = filtered.filter(x => x.assigned_department === dept);
    }
    if (priority) {
      filtered = filtered.filter(x => x.priority === priority);
    }
    if (search) {
      filtered = filtered.filter(x => 
        x.number.toLowerCase().includes(search) ||
        x.title.toLowerCase().includes(search) ||
        (x.description && x.description.toLowerCase().includes(search))
      );
    }

    // Update KPI counters
    const activeList = list.filter(x => !['Resolved', 'Closed'].includes(x.status));
    $('kpi-active-incidents').textContent = activeList.length;
    $('kpi-active-incidents-sub').textContent = `${activeList.filter(x => x.status === 'New').length} unassigned tickets`;

    const breachedList = activeList.filter(x => x.sla_status === 'Breached' || new Date() > new Date(x.sla_due_at));
    $('kpi-breached-incidents').textContent = breachedList.length;
    $('kpi-breached-incidents-sub').textContent = `${breachedList.length} SLAs breached`;

    const p1List = activeList.filter(x => x.priority === 'P1');
    $('kpi-p1-incidents').textContent = p1List.length;
    $('kpi-p1-incidents-sub').textContent = `${p1List.length} urgent triggers`;

    const myId = currentUser?.id;
    const myList = activeList.filter(x => x.assigned_to === myId);
    $('kpi-my-incidents').textContent = myList.length;
    $('kpi-my-incidents-sub').textContent = `${myList.length} tickets to solve`;

    // Render Table
    const tbody = $('incidentsTable');
    tbody.innerHTML = '';

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted p-4">No incidents logged matching criteria.</td></tr>';
      return;
    }

    filtered.forEach(inc => {
      // Determine priority badge class
      const pBadgeClass = inc.priority.toLowerCase();
      
      const tr = document.createElement('tr');
      tr.setAttribute('data-incident-id', inc.id);
      tr.setAttribute('data-sla-due', inc.sla_due_at);
      tr.setAttribute('data-created-at', inc.created_at);
      tr.setAttribute('data-status', inc.status);
      tr.setAttribute('data-priority', inc.priority);

      tr.innerHTML = `
        <td class="sticky-col"><strong><a href="#" onclick="openIncidentDetails('${inc.id}'); event.preventDefault();">${inc.number}</a></strong></td>
        <td>
          <div class="font-weight-bold">${inc.title}</div>
          <div class="text-muted text-truncate-cell" title="${inc.description || ''}">${inc.description || '—'}</div>
        </td>
        <td><span class="badge badge-${pBadgeClass}">${inc.priority}</span></td>
        <td><span class="badge badge-${inc.caller_department.toLowerCase()}">${inc.caller_department.replace(/_user|_manager/g, '')}</span></td>
        <td><span class="badge badge-${inc.assigned_department.toLowerCase()}">${inc.assigned_department.replace(/_user|_manager/g, '')}</span></td>
        <td><strong>${inc.assignee_name || '—'}</strong></td>
        <td>${buildBadge(inc.status)}</td>
        <td>
          <div class="sla-container" id="sla-wrap-${inc.id}">
            <!-- SLA visual timers rendered dynamically -->
            <span class="sla-timer" id="sla-timer-${inc.id}">Calculating...</span>
            <div class="sla-progress-bar" style="margin-top: 3px; max-width: 140px;">
              <div class="sla-progress-fill" id="sla-fill-${inc.id}" style="width: 100%;"></div>
            </div>
          </div>
        </td>
        <td>
          <button class="btn btn-secondary btn-xs" onclick="openIncidentDetails('${inc.id}')">View</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // Start live ticking
    if (!slaInterval) {
      slaInterval = setInterval(tickSlaTimers, 1000);
    }
    // Immediate tick
    tickSlaTimers();

  } catch (err) {
    console.error('Error loading incidents:', err);
  } finally {
    showLoader(false);
  }
}

// Live counts down SLA timers and rendering colors
function tickSlaTimers() {
  const rows = document.querySelectorAll('#incidentsTable tr[data-incident-id]');
  const isDetailsOpen = $('modalIncidentDetail').classList.contains('open');

  rows.forEach(row => {
    const id = row.getAttribute('data-incident-id');
    const slaDueStr = row.getAttribute('data-sla-due');
    const createdStr = row.getAttribute('data-created-at');
    const status = row.getAttribute('data-status');
    const priority = row.getAttribute('data-priority');

    const now = new Date().getTime();
    const created = new Date(createdStr).getTime();
    const slaDue = new Date(slaDueStr).getTime();
    const totalDuration = slaDue - created;

    const timerSpan = $(`sla-timer-${id}`);
    const fillBar = $(`sla-fill-${id}`);

    // If Resolved or Closed, SLA stops counting
    if (['Resolved', 'Closed'].includes(status)) {
      if (timerSpan) {
        timerSpan.textContent = 'Completed';
        timerSpan.className = 'sla-timer sla-safe';
      }
      if (fillBar) {
        fillBar.style.width = '100%';
        fillBar.className = 'sla-progress-fill sla-fill-safe';
      }

      // Update details SLA if this incident detail is open
      if (isDetailsOpen && currentIncident && currentIncident.id === id) {
        $('incDetailSlaTimer').textContent = 'Completed';
        $('incDetailSlaTimer').className = 'sla-timer sla-safe';
        $('incDetailSlaProgressFill').style.width = '100%';
        $('incDetailSlaProgressFill').className = 'sla-progress-fill sla-fill-safe';
      }
      return;
    }

    // On Hold - SLA is paused
    if (status === 'On Hold') {
      if (timerSpan) {
        timerSpan.textContent = 'Paused';
        timerSpan.className = 'sla-timer';
      }
      if (fillBar) {
        fillBar.style.width = '100%';
        fillBar.className = 'sla-progress-fill';
      }
      if (isDetailsOpen && currentIncident && currentIncident.id === id) {
        $('incDetailSlaTimer').textContent = 'Paused';
        $('incDetailSlaTimer').className = 'sla-timer';
        $('incDetailSlaProgressFill').style.width = '100%';
        $('incDetailSlaProgressFill').className = 'sla-progress-fill';
      }
      return;
    }

    const timeRemaining = slaDue - now;

    let timerText = '';
    let timerClass = 'sla-safe';
    let fillClass = 'sla-fill-safe';
    let pct = 100;

    if (timeRemaining <= 0) {
      timerText = 'Breached';
      timerClass = 'sla-timer sla-breached';
      fillClass = 'sla-fill-breached';
      pct = 100;
    } else {
      pct = (timeRemaining / totalDuration) * 100;
      pct = Math.max(0, Math.min(100, pct));

      // Visual warning triggers (warning if under 20% SLA remaining)
      if (pct < 20) {
        timerClass = 'sla-timer sla-warning';
        fillClass = 'sla-fill-warning';
      }

      // Format remaining time hh:mm:ss
      const hrs = Math.floor(timeRemaining / (3600 * 1000));
      const mins = Math.floor((timeRemaining % (3600 * 1000)) / (60 * 1000));
      const secs = Math.floor((timeRemaining % (60 * 1000)) / 1000);
      timerText = `${hrs}h ${mins}m ${secs}s`;
    }

    if (timerSpan) {
      timerSpan.textContent = timerText;
      timerSpan.className = `sla-timer ${timerClass}`;
    }
    if (fillBar) {
      fillBar.style.width = `${pct}%`;
      fillBar.className = `sla-progress-fill ${fillClass}`;
    }

    // Render detail SLA if active
    if (isDetailsOpen && currentIncident && currentIncident.id === id) {
      $('incDetailSlaTimer').textContent = timerText;
      $('incDetailSlaTimer').className = `sla-timer ${timerClass}`;
      $('incDetailSlaProgressFill').style.width = `${pct}%`;
      $('incDetailSlaProgressFill').className = `sla-progress-fill ${fillClass}`;
    }
  });
}

// Opens the side modal with detailed incident log, reassignments, comments stream, and overrides
async function openIncidentDetails(id) {
  showLoader(true);
  try {
    const inc = await apiFetch(`/api/incidents/${id}`);
    currentIncident = inc;

    $('incDetailNumber').textContent = `Incident: ${inc.number}`;
    $('incDetailTitle').textContent = inc.title;
    $('incDetailDescription').textContent = inc.description || '—';
    $('incDetailSlaDue').textContent = format.datetime(inc.sla_due_at);
    
    // Status Badge
    const statusContainer = $('incDetailStatusBadge');
    statusContainer.innerHTML = buildBadge(inc.status);

    const slaStateContainer = $('incDetailSlaState');
    slaStateContainer.innerHTML = `<span class="badge badge-${inc.sla_status === 'Breached' ? 'failed' : (inc.sla_status === 'Completed' ? 'fully_delivered' : 'in_progress')}">${inc.sla_status}</span>`;

    // Dropdowns
    $('incDetailStatus').value = inc.status;
    $('incDetailReassignDept').value = inc.assigned_department;

    // Load active staff for assignment selection
    const staffSelect = $('incDetailAssignee');
    staffSelect.innerHTML = '<option value="">-- Unassigned --</option>';
    const users = await apiFetch('/api/users');
    users.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = `${u.full_name} (${u.role.replace(/_user|_manager/g, '')})`;
      staffSelect.appendChild(opt);
    });
    staffSelect.value = inc.assigned_to || '';

    // Show SLA overrides only for security admins (Elevated Role)
    const overrideWrap = $('slaOverrideWrapper');
    if (currentUser?.isElevated) {
      overrideWrap.style.display = 'block';
      // Default to current SLA time
      if (inc.sla_due_at) {
        const d = new Date(inc.sla_due_at);
        d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
        $('incDetailOverrideSla').value = d.toISOString().slice(0, 16);
      }
    } else {
      overrideWrap.style.display = 'none';
    }

    // Render updates Timeline Stream
    renderTimelineStream(inc.updates || []);
    
    // Clear update input text
    $('incDetailNewUpdateText').value = '';
    setTimelineUpdateType('comment'); // default tab

    openModal('modalIncidentDetail');
  } catch (err) {
    console.error(err);
  } finally {
    showLoader(false);
  }
}

// Renders the timeline list of Comments, Work Notes and audit logs
function renderTimelineStream(updates) {
  const stream = $('incDetailTimeline');
  stream.innerHTML = '';
  
  if (updates.length === 0) {
    stream.innerHTML = '<div class="text-center text-muted p-2">No activity logged.</div>';
    return;
  }

  // If standard user, filter out internal 'work_note' timeline updates (ServiceNow style)
  const filtered = updates.filter(u => {
    if (u.update_type === 'work_note') {
      // Only admin, business owners or assigned groups can see internal work notes
      return ['admin', 'business_owner', 'inventory_manager'].includes(currentUser?.role);
    }
    return true;
  });

  filtered.forEach(u => {
    const item = document.createElement('div');
    item.className = `timeline-item ${u.update_type}`;
    
    let typeBadgeText = 'System';
    if (u.update_type === 'comment') typeBadgeText = 'Comment';
    if (u.update_type === 'work_note') typeBadgeText = 'Work Note';

    item.innerHTML = `
      <div class="timeline-meta">
        <div class="timeline-meta-left">
          <span class="timeline-badge">${typeBadgeText}</span>
          <strong>${u.user_name || 'System'}</strong>
        </div>
        <span>${format.datetime(u.created_at)}</span>
      </div>
      <div>${u.content}</div>
    `;
    stream.appendChild(item);
  });
  
  // Scroll to bottom of stream
  setTimeout(() => stream.scrollTop = stream.scrollHeight, 100);
}

// ── Bind event handlers for ServiceNow Modals ─────────────────────────────────

// Create ticket submit
$('createIncidentForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    title: $('incTitle').value.trim(),
    description: $('incDescription').value.trim(),
    priority: $('incPriority').value,
    assigned_department: $('incAssignedDept').value
  };

  showLoader(true);
  try {
    await apiFetch('/api/incidents', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    toast('Operational Incident logged successfully');
    closeModal('modalCreateIncident');
    loadIncidents();
  } catch (err) {
    console.error(err);
  } finally {
    showLoader(false);
  }
});

// Update Assignee
$('incDetailAssignee').addEventListener('change', async () => {
  if (!currentIncident) return;
  showLoader(true);
  try {
    await apiFetch(`/api/incidents/${currentIncident.id}`, {
      method: 'PUT',
      body: JSON.stringify({ assigned_to: $('incDetailAssignee').value || null })
    });
    toast('Ticket assignee updated');
    openIncidentDetails(currentIncident.id);
    loadIncidents();
  } catch (err) {
    console.error(err);
  } finally {
    showLoader(false);
  }
});

// Update Status
$('incDetailStatus').addEventListener('change', async () => {
  if (!currentIncident) return;
  showLoader(true);
  try {
    await apiFetch(`/api/incidents/${currentIncident.id}`, {
      method: 'PUT',
      body: JSON.stringify({ status: $('incDetailStatus').value })
    });
    toast('Ticket status updated');
    openIncidentDetails(currentIncident.id);
    loadIncidents();
  } catch (err) {
    console.error(err);
  } finally {
    showLoader(false);
  }
});

// Post timeline comment/work note
$('btnIncPostUpdate').addEventListener('click', async () => {
  if (!currentIncident) return;
  const content = $('incDetailNewUpdateText').value.trim();
  if (!content) {
    toast('Please type some content before posting', 'error');
    return;
  }

  showLoader(true);
  try {
    await apiFetch(`/api/incidents/${currentIncident.id}/updates`, {
      method: 'POST',
      body: JSON.stringify({ content, update_type: activeIncidentTimelineType })
    });
    toast(activeIncidentTimelineType === 'comment' ? 'Comment posted' : 'Work note saved');
    openIncidentDetails(currentIncident.id);
  } catch (err) {
    console.error(err);
  } finally {
    showLoader(false);
  }
});

// Reassign Department group
$('btnIncDetailReassign').addEventListener('click', async () => {
  if (!currentIncident) return;
  const newDept = $('incDetailReassignDept').value;
  if (newDept === currentIncident.assigned_department) {
    toast('Ticket is already assigned to this department', 'info');
    return;
  }

  showLoader(true);
  try {
    await apiFetch(`/api/incidents/${currentIncident.id}/reassign`, {
      method: 'POST',
      body: JSON.stringify({ department: newDept })
    });
    toast('Ticket department group reassigned successfully');
    openIncidentDetails(currentIncident.id);
    loadIncidents();
  } catch (err) {
    console.error(err);
  } finally {
    showLoader(false);
  }
});

// Override SLA manually (Security Admin elevated role only)
$('btnIncOverrideSla').addEventListener('click', async () => {
  if (!currentIncident) return;
  const overrideSla = $('incDetailOverrideSla').value;
  if (!overrideSla) {
    toast('Please pick an override SLA timestamp', 'error');
    return;
  }

  showLoader(true);
  try {
    await apiFetch(`/api/incidents/${currentIncident.id}/override-sla`, {
      method: 'POST',
      body: JSON.stringify({ new_sla_due: new Date(overrideSla).toISOString() })
    });
    toast('SLA overridden successfully by Security Admin');
    openIncidentDetails(currentIncident.id);
    loadIncidents();
  } catch (err) {
    console.error(err);
  } finally {
    showLoader(false);
  }
});

// Create Incident Button Click Trigger
$('btnCreateIncident').onclick = () => {
  $('createIncidentForm').reset();
  openModal('modalCreateIncident');
};

// Search / filters binding on incident panel
$('incidentDeptFilter').addEventListener('change', loadIncidents);
$('incidentPriorityFilter').addEventListener('change', loadIncidents);
$('incidentSearch').addEventListener('input', debounce(loadIncidents, 350));

// ── Bind Elevate Role session authentication logic ───────────────────────────

$('btnElevateRole').onclick = () => {
  $('elevateForm').reset();
  $('elevateUserLabel').textContent = currentUser?.full_name || 'System Admin';
  $('elevateErrorAlert').style.display = 'none';
  openModal('modalElevateRole');
};

$('elevateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = $('elevatePassword').value;
  
  showLoader(true);
  $('elevateErrorAlert').style.display = 'none';
  
  try {
    const res = await apiFetch('/api/auth/elevate', {
      method: 'POST',
      body: JSON.stringify({ password })
    });
    
    if (res.ok) {
      toast('Privilege Elevation Active — Security Admin Mode initialized', 'success');
      closeModal('modalElevateRole');
      
      // Update global user model
      currentUser.isElevated = true;
      updateElevationHeaderUI(true);
      
      // Reload current tab view to unlock locking screens instantly
      navigateTo(activePage);
    }
  } catch (err) {
    $('elevateErrorAlert').textContent = err.message || 'Invalid administrator password';
    $('elevateErrorAlert').style.display = 'block';
  } finally {
    showLoader(false);
  }
});

$('elevatedRoleBadge').onclick = async () => {
  if (confirm('De-elevate session privileges and return to normal administrator rights?')) {
    showLoader(true);
    try {
      const res = await apiFetch('/api/auth/de-elevate', { method: 'POST' });
      if (res.ok) {
        toast('Privilege De-elevation Active — Normal Admin permissions restored');
        currentUser.isElevated = false;
        updateElevationHeaderUI(false);
        navigateTo(activePage); // Lock screens on protected tabs immediately
      }
    } catch (e) {
      console.error(e);
    } finally {
      showLoader(false);
    }
  }
};

// ── Bootstrap logic ──────────────────────────────────────────────────────
let cache = {
  workCenters: []
};

// Collapsible Sidebar logic
$('sidebarToggle').addEventListener('click', () => {
  $('sidebar').classList.toggle('collapsed');
  $('main').classList.toggle('sidebar-collapsed');
});

// Mobile menu toggle
const mobileToggle = $('mobileToggle');
if (mobileToggle) {
  mobileToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    $('sidebar').classList.toggle('open-mobile');
  });
}

// Click outside to close mobile sidebar
document.addEventListener('click', (e) => {
  if (window.innerWidth <= 768) {
    const sidebar = $('sidebar');
    const mobToggle = $('mobileToggle');
    if (sidebar && sidebar.classList.contains('open-mobile') && !sidebar.contains(e.target) && (!mobToggle || !mobToggle.contains(e.target))) {
      sidebar.classList.remove('open-mobile');
    }
  }
});

// Debounce helper
function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// Document Load Boot
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
});

