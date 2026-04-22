// NH consultant booking API — mirrors the logic from NH.com-profiles

const BOOKING_BASE = 'https://api.nuffieldhealth.com/booking/consultant/';
const CONCURRENCY = 2;

let active = 0;
const queue = [];

function withLimit(task) {
  return new Promise((resolve, reject) => {
    const run = () => {
      active++;
      Promise.resolve().then(task).then(resolve, reject).finally(() => {
        active--;
        if (queue.length) queue.shift()();
      });
    };
    if (active < CONCURRENCY) run();
    else queue.push(run);
  });
}

async function fetchBookingJson(url, apimKey, maxAttempts = 5) {
  const headers = {
    accept: 'application/json',
    'content-type': 'application/json',
    'ocp-apim-subscription-key': apimKey,
    'x-transaction-id': `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    'user-agent': 'Mozilla/5.0 (compatible; consultant-audit/1.0)',
  };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await fetch(url, { headers });
      if (resp.status === 200) return resp.json();
      if (resp.status === 404) return null;
      if (resp.status === 429 && attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, 2000 * attempt));
        continue;
      }
      if (resp.status >= 500 && attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, 500 * attempt));
        continue;
      }
    } catch (e) {
      if (attempt === maxAttempts) throw e;
      await new Promise(r => setTimeout(r, 500 * attempt));
    }
  }
  return null;
}

function daysBetween(fromYmd, toYmd) {
  const [fy, fm, fd] = fromYmd.split('-').map(Number);
  const [ty, tm, td] = toYmd.split('-').map(Number);
  const a = Date.UTC(fy, fm - 1, fd);
  const b = Date.UTC(ty, tm - 1, td);
  return Math.round((b - a) / 86400000);
}

async function fetchBookingMetrics(gmcCode, hospitalId, fromDateYmd, apimKey) {
  if (!gmcCode || !hospitalId || !apimKey) return null;
  const uid = Date.now().toString(36);
  const url = BOOKING_BASE + '1.0/slots' +
    '?uid=' + encodeURIComponent(uid) +
    '&fromDate=' + encodeURIComponent(fromDateYmd) +
    '&gmcCode=' + encodeURIComponent(gmcCode) +
    '&hospitalId=' + encodeURIComponent(hospitalId) +
    '&sessionDays=28';

  const payload = await fetchBookingJson(url, apimKey);
  const details = payload?.response?.responseData?.bookingDetails;
  if (!Array.isArray(details)) return null;

  const firstDate = details.length > 0 && details[0].slotDate ? String(details[0].slotDate) : null;
  return {
    appointmentsNext4Weeks: details.length,
    firstAvailableDaysAway: firstDate ? daysBetween(fromDateYmd, firstDate) : null,
  };
}

export async function fetchBookingMetricsAcrossHospitals(gmcCode, hospitalEntries, fromDateYmd, apimKey) {
  if (!gmcCode || !hospitalEntries?.length || !apimKey) return null;

  const seen = new Set();
  const unique = hospitalEntries.filter(h => {
    if (!h?.id || seen.has(h.id)) return false;
    seen.add(h.id);
    return true;
  });

  const byHospital = {};
  for (const h of unique) {
    try {
      const m = await withLimit(() => fetchBookingMetrics(gmcCode, h.id, fromDateYmd, apimKey));
      if (m) byHospital[h.title || h.id] = m;
    } catch (_) { /* ignore per-hospital errors */ }
  }

  const values = Object.values(byHospital).filter(v => Number.isFinite(v?.appointmentsNext4Weeks));
  if (!values.length) return null;

  const appointmentsNext4Weeks = values.reduce((s, v) => s + (v.appointmentsNext4Weeks || 0), 0);
  const firsts = values.map(v => v.firstAvailableDaysAway).filter(n => Number.isFinite(n) && n >= 0);
  return {
    appointmentsNext4Weeks,
    firstAvailableDaysAway: firsts.length ? Math.min(...firsts) : null,
    byHospital,
  };
}
