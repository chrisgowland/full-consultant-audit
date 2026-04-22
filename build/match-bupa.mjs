import zlib from 'zlib';
import { promisify } from 'util';

const gunzip = promisify(zlib.gunzip);

const SITEMAP_URLS = [
  'https://www.finder.bupa.co.uk/sitemap_001.xml.gz',
  'https://www.finder.bupa.co.uk/sitemap_002.xml.gz',
];

const TITLE_WORDS = /^(mr|mrs|ms|miss|dr|prof|professor|sir|lord|dame|rev)\b/gi;

async function fetchGzippedText(url) {
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; audit-bot/1.0)' },
  });
  if (!resp.ok) throw new Error(`${url}: HTTP ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  const decompressed = await gunzip(buf);
  return decompressed.toString('utf8');
}

export async function buildBupaIndex() {
  const allEntries = [];
  for (const url of SITEMAP_URLS) {
    try {
      console.log(`  Fetching BUPA sitemap ${url}...`);
      const xml = await fetchGzippedText(url);
      const re = /<loc>(https:\/\/www\.finder\.bupa\.co\.uk\/Consultant\/view\/[^<]+)<\/loc>/gi;
      let m;
      while ((m = re.exec(xml)) !== null) {
        const fullUrl = m[1].trim();
        const slugMatch = fullUrl.match(/\/Consultant\/view\/[^/]+\/([^/?#]+)/i);
        if (slugMatch) allEntries.push({ url: fullUrl, slug: slugMatch[1] });
      }
      console.log(`    → ${allEntries.length} total so far`);
    } catch (e) {
      console.warn(`  Warning: could not fetch BUPA sitemap ${url}: ${e.message}`);
    }
  }

  // Build index: normalizedName → entries[]
  const index = new Map();
  for (const entry of allEntries) {
    const norm = slugToNormalized(entry.slug);
    if (!norm) continue;
    if (!index.has(norm)) index.set(norm, []);
    index.get(norm).push(entry);
  }
  console.log(`  BUPA index built: ${allEntries.length} entries, ${index.size} unique names`);
  return index;
}

function slugToNormalized(slug) {
  return slug
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(TITLE_WORDS, '')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameToNormalized(name) {
  return name
    .toLowerCase()
    .replace(TITLE_WORDS, '')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function namePartsCompatible(nParts, bParts) {
  if (!nParts.length || !bParts.length) return false;
  const nLast = nParts[nParts.length - 1];
  const bLast = bParts[bParts.length - 1];
  if (nLast !== bLast) return false;

  const nForename = nParts.slice(0, -1);
  const bForename = bParts.slice(0, -1);
  if (!nForename.length && !bForename.length) return true;
  if (!nForename.length || !bForename.length) return false;

  const ref = nForename.length <= bForename.length ? nForename : bForename;
  const other = ref === nForename ? bForename : nForename;

  return ref.every(part =>
    part.length === 1
      ? other.some(op => op.startsWith(part))
      : other.includes(part)
  );
}

export function matchConsultantToBupa(nhName, bupaIndex) {
  const normalized = nameToNormalized(nhName);
  if (!normalized) return null;

  // Exact match
  const exact = bupaIndex.get(normalized);
  if (exact?.length === 1) return { url: exact[0].url, confidence: 'high' };
  if (exact?.length > 1) return null; // ambiguous

  // Partial match by name parts
  const nParts = normalized.split(' ');
  const candidates = [];
  for (const [bNorm, entries] of bupaIndex) {
    const bParts = bNorm.split(' ');
    if (namePartsCompatible(nParts, bParts)) {
      for (const e of entries) {
        if (!candidates.some(c => c.url === e.url)) candidates.push(e);
      }
    }
  }
  if (candidates.length === 1) return { url: candidates[0].url, confidence: 'medium' };
  return null;
}
