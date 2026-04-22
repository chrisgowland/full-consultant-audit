/* global state */
let allRecords = [];
let activeTab = 'summary';
const filters = {
  search: '',
  specialty: '',
  treatment: '',
  hospital: '',
  region: '',
  nhResult: '',
  nhBooking: '',
  bupaFound: '',
  bupaResult: '',
};

/* ── data loading ── */
async function loadData() {
  try {
    const resp = await fetch('data/combined.json?' + Date.now());
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    allRecords = json.records || [];
    renderMeta(json);
    populateFilterOptions();
    render();
  } catch (e) {
    document.getElementById('results-count').textContent = 'Failed to load data: ' + e.message;
  }
}

function renderMeta(json) {
  const updated = json.last_updated ? new Date(json.last_updated).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }) : 'unknown';
  document.getElementById('meta').innerHTML =
    `<span>${(json.total || 0).toLocaleString()} consultants</span>` +
    `<span>NH pass rate: <strong>${json.nhPassRate || '–'}</strong></span>` +
    `<span>BUPA match rate: <strong>${json.bupaFoundRate || '–'}</strong></span>` +
    `<span>Updated: ${updated}</span>`;
  document.getElementById('footer-meta').textContent =
    `Last updated ${updated} · ${json.build_duration_seconds || '?'}s build`;
}

/* ── filter options ── */
function populateFilterOptions() {
  const specialties = new Set();
  const treatments = new Set();
  const hospitals = new Set();

  for (const r of allRecords) {
    (r.specialties || []).forEach(s => specialties.add(s));
    (r.treatments || []).forEach(t => treatments.add(t));
    (r.hospitals || []).forEach(h => hospitals.add(h));
  }

  fillSelect('filter-specialty', [...specialties].sort());
  fillSelect('filter-treatment', [...treatments].sort());
  fillSelect('filter-hospital', [...hospitals].sort());
}

function fillSelect(id, options) {
  const sel = document.getElementById(id);
  const first = sel.options[0];
  sel.innerHTML = '';
  sel.appendChild(first);
  for (const opt of options) {
    const el = document.createElement('option');
    el.value = opt;
    el.textContent = opt;
    sel.appendChild(el);
  }
}

/* ── filtering ── */
function filterRecords() {
  const q = filters.search.toLowerCase();
  return allRecords.filter(r => {
    if (q && !r.name.toLowerCase().includes(q)) return false;
    if (filters.specialty && !(r.specialties || []).includes(filters.specialty)) return false;
    if (filters.treatment && !(r.treatments || []).includes(filters.treatment)) return false;
    if (filters.hospital && !(r.hospitals || []).includes(filters.hospital)) return false;
    if (filters.region && r.region !== filters.region) return false;

    if (activeTab === 'nh' || activeTab === 'summary') {
      if (filters.nhResult === 'pass' && !r.nh?.overallPass) return false;
      if (filters.nhResult === 'fail' && r.nh?.overallPass) return false;
      if (filters.nhBooking === 'bookable' && !r.nh?.criteria?.bookOnlinePass) return false;
      if (filters.nhBooking === 'not_bookable' && r.nh?.criteria?.bookOnlinePass) return false;
    }

    if (activeTab === 'bupa' || activeTab === 'summary') {
      if (filters.bupaFound === 'found' && !r.bupa?.found) return false;
      if (filters.bupaFound === 'not_found' && r.bupa?.found) return false;
      if (filters.bupaResult) {
        const score = parseInt(r.bupa?.coreScore || '0', 10);
        if (filters.bupaResult === 'high' && score < 7) return false;
        if (filters.bupaResult === 'mid' && (score < 4 || score > 6)) return false;
        if (filters.bupaResult === 'low' && score > 3) return false;
      }
    }

    return true;
  });
}

/* ── rendering ── */
function render() {
  const records = filterRecords();
  document.getElementById('results-count').textContent =
    `${records.length.toLocaleString()} consultant${records.length !== 1 ? 's' : ''}`;
  document.getElementById('no-results').style.display = records.length ? 'none' : '';

  if (activeTab === 'summary') { renderSummary(records); renderSummaryStats(records); }
  if (activeTab === 'nh') { renderNH(records); renderNHStats(records); }
  if (activeTab === 'bupa') { renderBUPA(records); renderBUPAStats(records); }
  updateStickyOffsets();
}

function badge(val, trueLabel = '✓', falseLabel = '✗') {
  if (val === null || val === undefined) return '<span class="badge badge-na">–</span>';
  return val
    ? `<span class="badge badge-pass">${trueLabel}</span>`
    : `<span class="badge badge-fail">${falseLabel}</span>`;
}

function overallBadge(nhPass, bupaFound, bupaScore) {
  if (!bupaFound) return nhPass
    ? '<span class="badge badge-pass">NH✓</span> <span class="badge badge-na">–</span>'
    : '<span class="badge badge-fail">NH✗</span> <span class="badge badge-na">–</span>';
  const b = parseInt(bupaScore || '0', 10) >= 7;
  if (nhPass && b) return '<span class="badge badge-pass">NH✓</span> <span class="badge badge-pass">B✓</span>';
  if (nhPass || b) return `<span class="badge ${nhPass ? 'badge-pass' : 'badge-fail'}">${nhPass ? 'NH✓' : 'NH✗'}</span> <span class="badge ${b ? 'badge-pass' : 'badge-fail'}">${b ? 'B✓' : 'B✗'}</span>`;
  return '<span class="badge badge-fail">NH✗</span> <span class="badge badge-fail">B✗</span>';
}

function scoreBar(score, max) {
  const n = parseInt(score, 10) || 0;
  const pct = max ? Math.round((n / max) * 100) : 0;
  const cls = pct >= 78 ? 'bar-high' : pct >= 44 ? 'bar-mid' : 'bar-low';
  return `<span class="score-bar ${cls}" title="${score}/${max}">${score}/${max}</span>`;
}

function pePlain(score, max) {
  if (score === null || score === undefined) return '<span class="badge badge-na">–</span>';
  const cls = score >= max * 0.6 ? 'badge-pass' : score >= max * 0.3 ? 'badge-amber' : 'badge-fail';
  return `<span class="badge ${cls}">${score}/${max}</span>`;
}

function nhScoreCount(criteria) {
  if (!criteria) return '?/8';
  const keys = ['photoPass', 'clinicalTermsPass', 'specialtyPass', 'proceduresPass',
    'insurersPass', 'qualificationsPass', 'gmcPass', 'bookOnlinePass'];
  const passed = keys.filter(k => criteria[k]).length;
  return `${passed}/8`;
}

function truncate(arr, n = 2) {
  if (!arr || !arr.length) return '<span class="muted">None</span>';
  const shown = arr.slice(0, n).join(', ');
  return arr.length > n ? `${shown} <span class="muted">+${arr.length - n}</span>` : shown;
}

function consultantLink(r) {
  const nhUrl = r.nh?.url;
  const nameHtml = nhUrl ? `<a href="${nhUrl}" target="_blank" rel="noopener">${esc(r.name)}</a>` : esc(r.name);
  const gmc = r.gmc ? `<span class="gmc">GMC ${r.gmc}</span>` : '';
  return nameHtml + gmc;
}

function esc(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ── Summary tab ── */
function renderSummaryStats(records) {
  const total = records.length;
  const nhPass = records.filter(r => r.nh?.overallPass).length;
  const bupaFound = records.filter(r => r.bupa?.found).length;
  const bupaPass = records.filter(r => r.bupa?.found && parseInt(r.bupa?.coreScore, 10) >= 7).length;

  document.getElementById('stats-summary').innerHTML =
    statBox('Consultants', total.toLocaleString(), '') +
    statBox('Nuffield Health pass', pct(nhPass, total), `${nhPass.toLocaleString()} of ${total.toLocaleString()}`) +
    statBox('BUPA pass (≥ 7/9)', pct(bupaPass, bupaFound), `${bupaPass.toLocaleString()} of ${bupaFound.toLocaleString()} found`);
}

function renderSummary(records) {
  const tbody = document.getElementById('tbody-summary');
  tbody.innerHTML = records.map(r => {
    const nhPass = r.nh?.overallPass;
    const bupaFound = r.bupa?.found;
    const bupaScore = r.bupa?.coreScore || '–';

    const bupaOverall = bupaFound
      ? (parseInt(r.bupa.coreScore, 10) >= 7
        ? '<span class="badge badge-pass">✓</span>'
        : '<span class="badge badge-fail">✗</span>')
      : '<span class="badge badge-na">–</span>';

    return `<tr>
      <td>${consultantLink(r)}</td>
      <td>${truncate(r.specialties, 2)}</td>
      <td>${truncate(r.hospitals, 1)}</td>
      <td><span class="region region-${(r.region || '').toLowerCase()}">${r.region || '–'}</span></td>
      <td>${badge(nhPass)}</td>
      <td>${bupaOverall}</td>
      <td>${scoreBar(nhScoreCount(r.nh?.criteria).split('/')[0], 8)}</td>
      <td>${bupaFound ? scoreBar(bupaScore.split('/')[0], 9) : '<span class="badge badge-na">–</span>'}</td>
      <td>${badge(bupaFound)}</td>
    </tr>`;
  }).join('');
}

/* ── NH tab ── */
function renderNH(records) {
  const tbody = document.getElementById('tbody-nh');
  tbody.innerHTML = records.map(r => {
    const c = r.nh?.criteria || {};
    const booking = r.nh?.booking;
    const appts8 = booking?.appointmentsNext4Weeks;
    const under12 = appts8 !== null && appts8 !== undefined
      ? badge(appts8 < 12)
      : '<span class="badge badge-na">–</span>';
    return `<tr>
      <td>${consultantLink(r)}</td>
      <td>${truncate(r.specialties, 2)}</td>
      <td>${truncate(r.hospitals, 1)}</td>
      <td><span class="region region-${(r.region || '').toLowerCase()}">${r.region || '–'}</span></td>
      <td>${badge(r.nh?.overallPass)}</td>
      <td>${badge(c.photoPass)}</td>
      <td>${badge(c.clinicalTermsPass)}</td>
      <td>${badge(c.specialtyPass)}</td>
      <td>${badge(c.proceduresPass)}</td>
      <td>${badge(c.insurersPass)}</td>
      <td>${badge(c.qualificationsPass)}</td>
      <td>${badge(c.gmcPass)}</td>
      <td>${badge(c.bookOnlinePass)}</td>
      <td>${pePlain(r.nh?.plainEnglishScore, 5)}</td>
      <td>${appts8 !== null && appts8 !== undefined ? appts8 : '<span class="muted">–</span>'}</td>
      <td>${booking?.firstAvailableDaysAway !== null && booking?.firstAvailableDaysAway !== undefined ? booking.firstAvailableDaysAway + 'd' : '<span class="muted">–</span>'}</td>
      <td>${under12}</td>
      <td class="fixes">${(r.nh?.fixes || []).map(f => `<span class="fix-tag">${esc(f)}</span>`).join('')}</td>
    </tr>`;
  }).join('');
}

/* ── BUPA tab ── */
function renderBUPA(records) {
  const tbody = document.getElementById('tbody-bupa');
  tbody.innerHTML = records.map(r => {
    const c = r.bupa?.criteria || {};
    const bupaUrl = r.bupa?.url;
    const nameCell = bupaUrl
      ? `<a href="${bupaUrl}" target="_blank" rel="noopener">${esc(r.name)}</a>`
      : esc(r.name);
    const failed = (r.bupa?.failedAspects || []).map(f => `<span class="fix-tag">${esc(f)}</span>`).join('');
    const otherHospitals = r.bupa?.found && (r.bupa?.hospitalItems || []).length
      ? truncate(r.bupa.hospitalItems, 2)
      : '<span class="muted">–</span>';
    return `<tr>
      <td>${nameCell} ${r.gmc ? `<span class="gmc">GMC ${r.gmc}</span>` : ''}</td>
      <td>${truncate(r.specialties, 2)}</td>
      <td>${truncate(r.hospitals, 1)}</td>
      <td><span class="region region-${(r.region || '').toLowerCase()}">${r.region || '–'}</span></td>
      <td>${badge(r.bupa?.found, 'Found', 'Not found')}</td>
      <td>${r.bupa?.found ? scoreBar(r.bupa.coreScore.split('/')[0], 9) : '<span class="badge badge-na">–</span>'}</td>
      <td>${badge(c.photo)}</td>
      <td>${badge(c.specialty)}</td>
      <td>${badge(c.treatments)}</td>
      <td>${badge(c.feeAssured)}</td>
      <td>${badge(c.platinum)}</td>
      <td>${badge(c.openReferral)}</td>
      <td>${badge(c.nuffieldHospitalLink)}</td>
      <td>${badge(c.nuffieldConsultantLink)}</td>
      <td>${badge(c.anaesthetists)}</td>
      <td>${otherHospitals}</td>
      <td>${r.bupa?.found ? pePlain(r.bupa.plainEnglishScore, 10) : '<span class="badge badge-na">–</span>'}</td>
      <td class="fixes">${failed}</td>
    </tr>`;
  }).join('');
}

/* ── stat boxes ── */
function pct(n, d) {
  return d ? ((n / d) * 100).toFixed(0) + '%' : '–';
}

function statBox(label, value, sub) {
  return `<div class="stat-box">
    <div class="stat-value">${value}</div>
    <div class="stat-label">${label}</div>
    ${sub ? `<div class="stat-sub">${sub}</div>` : ''}
  </div>`;
}

function renderNHStats(records) {
  const total = records.length;
  const c = k => records.filter(r => r.nh?.criteria?.[k]).length;
  const pass = records.filter(r => r.nh?.overallPass).length;
  const withBooking = records.filter(r => r.nh?.booking != null).length;
  const noAppts7d = records.filter(r => {
    const b = r.nh?.booking;
    return b && (b.firstAvailableDaysAway === null || b.firstAvailableDaysAway > 7);
  }).length;
  const under12 = records.filter(r => {
    const b = r.nh?.booking;
    return b && b.appointmentsNext4Weeks !== null && b.appointmentsNext4Weeks !== undefined && b.appointmentsNext4Weeks < 12;
  }).length;
  const avgPE = total
    ? (records.reduce((s, r) => s + (r.nh?.plainEnglishScore || 0), 0) / total).toFixed(1)
    : '–';

  document.getElementById('stats-nh').innerHTML =
    statBox('Overall pass', pct(pass, total), `${pass.toLocaleString()} of ${total.toLocaleString()}`) +
    statBox('Photo', pct(c('photoPass'), total), c('photoPass').toLocaleString()) +
    statBox('Clinical Terms', pct(c('clinicalTermsPass'), total), c('clinicalTermsPass').toLocaleString()) +
    statBox('Specialty clear', pct(c('specialtyPass'), total), c('specialtyPass').toLocaleString()) +
    statBox('Procedures specified', pct(c('proceduresPass'), total), c('proceduresPass').toLocaleString()) +
    statBox('Insurers', pct(c('insurersPass'), total), c('insurersPass').toLocaleString()) +
    statBox('Qualifications', pct(c('qualificationsPass'), total), c('qualificationsPass').toLocaleString()) +
    statBox('GMC Number', pct(c('gmcPass'), total), c('gmcPass').toLocaleString()) +
    statBox('Book Online', pct(c('bookOnlinePass'), total), c('bookOnlinePass').toLocaleString()) +
    statBox('In booking system', pct(withBooking, total), withBooking.toLocaleString()) +
    statBox('No appts in 7 days', pct(noAppts7d, withBooking), `${noAppts7d.toLocaleString()} of bookable`) +
    statBox('< 12 appts (4 wk)', pct(under12, withBooking), `${under12.toLocaleString()} of bookable`) +
    statBox('Avg plain English', `${avgPE}/5`, `of ${total.toLocaleString()}`);
}

function renderBUPAStats(records) {
  const total = records.length;
  const found = records.filter(r => r.bupa?.found).length;
  const bc = k => records.filter(r => r.bupa?.found && r.bupa?.criteria?.[k]).length;
  const avgPE = found
    ? (records.filter(r => r.bupa?.found)
        .reduce((s, r) => s + (r.bupa?.plainEnglishScore || 0), 0) / found).toFixed(1)
    : '–';

  document.getElementById('stats-bupa').innerHTML =
    statBox('Found on BUPA', pct(found, total), `${found.toLocaleString()} of ${total.toLocaleString()}`) +
    statBox('Photo', pct(bc('photo'), found), `${bc('photo').toLocaleString()} of found`) +
    statBox('Specialty', pct(bc('specialty'), found), `${bc('specialty').toLocaleString()} of found`) +
    statBox('Treatments', pct(bc('treatments'), found), `${bc('treatments').toLocaleString()} of found`) +
    statBox('Fee Assured', pct(bc('feeAssured'), found), `${bc('feeAssured').toLocaleString()} of found`) +
    statBox('Platinum', pct(bc('platinum'), found), `${bc('platinum').toLocaleString()} of found`) +
    statBox('Open Referral', pct(bc('openReferral'), found), `${bc('openReferral').toLocaleString()} of found`) +
    statBox('NH Hospital Link', pct(bc('nuffieldHospitalLink'), found), `${bc('nuffieldHospitalLink').toLocaleString()} of found`) +
    statBox('NH Consultant Link', pct(bc('nuffieldConsultantLink'), found), `${bc('nuffieldConsultantLink').toLocaleString()} of found`) +
    statBox('Anaesthetists', pct(bc('anaesthetists'), found), `${bc('anaesthetists').toLocaleString()} of found`) +
    statBox('Avg plain English', `${avgPE}/10`, `of ${found.toLocaleString()} found`);
}

/* ── sticky offset — stat boxes live inside .table-wrap so same scroll context ── */
function updateStickyOffsets() {
  const statsEl = document.getElementById(`stats-${activeTab}`);
  const h = statsEl ? statsEl.offsetHeight : 0;
  document.querySelectorAll('thead th').forEach(th => { th.style.top = h + 'px'; });
}

/* ── tab switching ── */
function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  ['summary', 'nh', 'bupa'].forEach(t => {
    document.getElementById(`table-${t}`).style.display = t === tab ? '' : 'none';
    const tf = document.getElementById(`tab-filters-${t}`);
    if (tf) tf.style.display = t === tab ? '' : 'none';
  });
  render();
}

/* ── event wiring ── */
function wire() {
  document.getElementById('search').addEventListener('input', e => { filters.search = e.target.value; render(); });
  document.getElementById('filter-specialty').addEventListener('change', e => { filters.specialty = e.target.value; render(); });
  document.getElementById('filter-treatment').addEventListener('change', e => { filters.treatment = e.target.value; render(); });
  document.getElementById('filter-hospital').addEventListener('change', e => { filters.hospital = e.target.value; render(); });
  document.getElementById('filter-region').addEventListener('change', e => { filters.region = e.target.value; render(); });

  document.getElementById('filter-nh-result').addEventListener('change', e => { filters.nhResult = e.target.value; render(); });
  document.getElementById('filter-nh-booking').addEventListener('change', e => { filters.nhBooking = e.target.value; render(); });
  document.getElementById('filter-bupa-found').addEventListener('change', e => { filters.bupaFound = e.target.value; render(); });
  document.getElementById('filter-bupa-result').addEventListener('change', e => { filters.bupaResult = e.target.value; render(); });

  document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  document.getElementById('clear-filters').addEventListener('click', () => {
    Object.keys(filters).forEach(k => { filters[k] = ''; });
    document.querySelectorAll('select, input[type=search]').forEach(el => { el.value = ''; });
    render();
  });
}

wire();
loadData();
