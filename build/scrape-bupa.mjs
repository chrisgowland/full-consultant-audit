async function fetchWithRetry(url, retries = 4) {
  for (let i = 0; i < retries; i++) {
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; audit-bot/1.0)',
          Accept: 'text/html,application/xhtml+xml',
        },
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

function extractSection(html, headingText) {
  const re = new RegExp(
    `<h[2-5][^>]*>[^<]*${headingText}[^<]*<\/h[2-5]>([\\s\\S]*?)(?=<h[2-5]|<\/article|<\/main|$)`,
    'i'
  );
  const m = html.match(re);
  return m ? m[1] : '';
}

function extractListItems(html) {
  const items = [];
  const re = /<li\b[^>]*>([\s\S]*?)<\/li>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const text = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text && text.length < 200) items.push(text);
  }
  return items;
}

function extractLinks(html) {
  const links = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) links.push(m[1]);
  return links;
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function fetchBupaProfile(url) {
  const resp = await fetchWithRetry(url);
  if (!resp) return null;
  const html = await resp.text();
  return parseBupaHtml(html, url);
}

export function parseBupaHtml(html, url = '') {
  // Photo: id="gib-photo" block with a real image (not SVG placeholder)
  const photoBlock = html.match(/id=["']gib-photo["'][^>]*>([\s\S]*?)(?=<\/div>|<div\s)/i)?.[1] || '';
  const photoSrc = photoBlock.match(/src=["']([^"']+)["']/i)?.[1] || '';
  const photo = !!(photoSrc && !photoSrc.endsWith('.svg') && !photoSrc.includes('placeholder'));

  // Specialty: "Specialises in" section with list items
  const specSection = extractSection(html, 'Specialises in');
  const specialtyItems = extractListItems(specSection);
  const specialty = specialtyItems.length > 0;

  // Treatments: "Treatments and services" or ".procedure-hospital" paragraphs
  const treatSection = extractSection(html, 'Treatments and services') ||
    extractSection(html, 'Treatments') ||
    html.match(/class=["'][^"']*procedure-hospital[^"']*["'][^>]*>([\s\S]*?)<\/[a-z]+>/gi)?.join(' ') || '';
  const treatItems = extractListItems(treatSection);
  const treatments = treatItems.length > 0 || /procedure-hospital/i.test(html);

  // Fee Assured: is-fee-assured without is-not-fee-assured
  const feeAssured = /is-fee-assured/i.test(html) && !/is-not-fee-assured/i.test(html);

  // Platinum
  const platinum = /is-platinum-con/i.test(html);

  // Open Referral
  const openReferral = /is-open-network/i.test(html);

  // Nuffield hospital link
  const links = extractLinks(html);
  const nuffieldHospitalLink = links.some(l => /nuffieldhealth\.com\/hospitals?\//i.test(l));

  // Nuffield consultant profile link
  const nuffieldConsultantLink = links.some(l => /nuffieldhealth\.com\/consultants?\//i.test(l));

  // Anaesthetists
  const anaesSection = extractSection(html, 'Anaesthetist');
  const anaesItems = extractListItems(anaesSection);
  const anaesthetists = anaesItems.length > 0;

  // About text for plain English
  const aboutSection = extractSection(html, 'About me') || extractSection(html, 'About');
  const aboutText = stripTags(aboutSection);

  // Specialty name (for populating data)
  const specialisesSection = extractSection(html, 'Specialises in');
  const specialtyNames = extractListItems(specialisesSection);

  // Hospitals on BUPA profile (for data enrichment)
  const hospitalsSection = extractSection(html, 'Practices at') || extractSection(html, 'Hospital');
  const hospitalItems = extractListItems(hospitalsSection);

  return {
    photo,
    specialty,
    treatments,
    feeAssured,
    platinum,
    openReferral,
    nuffieldHospitalLink,
    nuffieldConsultantLink,
    anaesthetists,
    aboutText,
    specialtyNames,
    hospitalItems,
    url,
  };
}
