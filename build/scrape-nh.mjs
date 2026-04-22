import * as cheerio from 'cheerio';

const EXCLUDE_PATTERN = /\b(radiolog(?:y|ist|ical)|anaesthe(?:tics?|tist|sia)|anesthe(?:tics?|tist|sia))\b/i;
const SITEMAP_URL = 'https://www.nuffieldhealth.com/sitemap_consultants.xml';

async function fetchWithRetry(url, opts = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; audit-bot/1.0)' },
        ...opts,
      });
      if (resp.ok) return resp;
      if (resp.status === 404) return null;
    } catch (e) {
      if (i === retries - 1) throw e;
    }
    await new Promise(r => setTimeout(r, 800 * (i + 1)));
  }
  return null;
}

export async function fetchConsultantUrls() {
  const resp = await fetchWithRetry(SITEMAP_URL);
  if (!resp) throw new Error('Failed to fetch NH consultant sitemap');
  const xml = await resp.text();
  const urls = [];
  const re = /<loc>(https:\/\/www\.nuffieldhealth\.com\/consultants\/[^<]+)<\/loc>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    urls.push(m[1].trim());
  }
  return urls;
}

function textAfterHeading($, headingText) {
  let result = '';
  $('h2, h3, h4, h5').each((_, el) => {
    if (new RegExp(headingText, 'i').test($(el).text())) {
      result = $(el).next().text().trim();
      return false;
    }
  });
  return result;
}

function listAfterHeading($, headingText) {
  const items = [];
  $('h2, h3, h4, h5').each((_, el) => {
    if (new RegExp(headingText, 'i').test($(el).text())) {
      // Try immediate next sibling list
      $(el).next('ul, ol').find('li').each((_, li) => {
        const t = $(li).text().trim();
        if (t) items.push(t);
      });
      // Try content within the same section up to next heading
      $(el).nextUntil('h2, h3, h4, h5').find('li').each((_, li) => {
        const t = $(li).text().trim();
        if (t && !items.includes(t)) items.push(t);
      });
      return false;
    }
  });
  return items;
}

export async function parseConsultantProfile(url) {
  const resp = await fetchWithRetry(url);
  if (!resp) return null;
  const html = await resp.text();
  const $ = cheerio.load(html);

  // Remove nav, footer, scripts
  $('nav, footer, script, style, noscript').remove();

  const name = $('h1').first().text().trim().replace(/\s+/g, ' ');

  // GMC number
  const gmcMatch = html.match(/GMC\s+(?:number)?\s*:?\s*(\d{7})/i);
  const gmc = gmcMatch ? gmcMatch[1] : '';

  // Photo: thumbnail URL or any nuffieldhealth image
  let photoUrl = '';
  $('img').each((_, el) => {
    const src = $(el).attr('src') || '';
    if (src.includes('nuffieldhealth.com') || src.includes('_image/thumbnail')) {
      photoUrl = photoUrl || src;
    }
  });

  // Specialties
  let specialties = [];
  const specText = textAfterHeading($, 'special(?:ties|ty|ism)');
  if (specText) {
    specialties = specText.split(/[,\n\/]/).map(s => s.trim()).filter(s => s.length > 2 && s.length < 80);
  }

  // Treatments / procedures
  const treatments = listAfterHeading($, 'treatment|procedure|condition|service');

  // Qualifications
  let qualifications = [];
  const qualText = textAfterHeading($, 'qualification');
  if (qualText) {
    qualifications = qualText.split(/[,;]/).map(s => s.trim()).filter(s => s.length > 1);
  }

  // Insurers
  const insurers = listAfterHeading($, 'insur');
  // Also check for insurer names listed as plain text
  if (!insurers.length) {
    const insText = textAfterHeading($, 'insur');
    if (insText) insurers.push(...insText.split(/[,\n]/).map(s => s.trim()).filter(Boolean));
  }

  // About text
  let aboutText = textAfterHeading($, '^about');
  if (!aboutText) {
    // Fall back to first substantial paragraph
    $('p').each((_, el) => {
      const t = $(el).text().trim();
      if (t.length > 100 && !aboutText) aboutText = t;
    });
  }

  // Hospitals / locations
  const hospitals = [];
  $('h2, h3, h4, h5').each((_, el) => {
    if (/location|hospital|where.*work|clinic/i.test($(el).text())) {
      $(el).nextUntil('h2, h3, h4, h5').find('h3, h4, strong, [class*="title"], [class*="name"]').each((_, h) => {
        const t = $(h).text().trim();
        if (t && t.length > 3 && t.length < 80 && !hospitals.includes(t)) hospitals.push(t);
      });
    }
  });

  // Booking online: use the swiftype meta tag <meta name="bookable" content="true/false">
  const bookableMeta = html.match(/name=["']bookable["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/content=["']([^"']+)["'][^>]*name=["']bookable["']/i);
  const bookOnline = bookableMeta?.[1]?.toLowerCase() === 'true';

  // Hospital entries for booking API: <meta class="swiftype" name="hospitals" data-type="string" content='{"id":"...","title":"..."}'>
  const hospitalEntries = [];
  const hospMetaRe = /name=["']hospitals["'][^>]*content='([^']+)'/gi;
  let hm;
  while ((hm = hospMetaRe.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(hm[1]);
      if (parsed?.id) hospitalEntries.push({ id: String(parsed.id).trim(), title: String(parsed.title || '').trim() });
    } catch (_) { /* skip malformed */ }
  }

  return { name, url, gmc, specialties, treatments, qualifications, insurers, aboutText, photoUrl, hospitals, bookOnline, hospitalEntries };
}

export function isExcluded(consultant) {
  const combined = [...consultant.specialties, consultant.name].join(' ');
  return EXCLUDE_PATTERN.test(combined);
}
