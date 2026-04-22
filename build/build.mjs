#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pLimit from 'p-limit';

import { fetchConsultantUrls, parseConsultantProfile, isExcluded } from './scrape-nh.mjs';
import { scoreNH } from './score-nh.mjs';
import { buildBupaIndex, matchConsultantToBupa } from './match-bupa.mjs';
import { fetchBupaProfile } from './scrape-bupa.mjs';
import { scoreBUPA } from './score-bupa.mjs';
import { getRegion } from './regions.mjs';
import { fetchBookingMetricsAcrossHospitals } from './fetch-booking.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Public APIM key from the booking microsite bundle; override via BOOKING_APIM_KEY env var
const APIM_KEY = process.env.BOOKING_APIM_KEY || '882ee8ab406042dd9da8045dc58874a3';

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { limit: 0, workers: 8, output: join(__dirname, '..', 'data', 'combined.json') };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) opts.limit = parseInt(args[++i], 10);
    if (args[i] === '--workers' && args[i + 1]) opts.workers = parseInt(args[++i], 10);
    if (args[i] === '--output' && args[i + 1]) opts.output = args[++i];
  }
  return opts;
}

async function processConsultant(url, bupaIndex, fromDateYmd) {
  // 1. Fetch + parse NH profile
  const nhRaw = await parseConsultantProfile(url);
  if (!nhRaw || !nhRaw.name) return null;

  // 2. Score NH criteria
  const nhScore = scoreNH(nhRaw);

  // 3. Fetch booking availability (uses hospitalEntries extracted from Swiftype meta)
  const booking = await fetchBookingMetricsAcrossHospitals(
    nhRaw.gmc, nhRaw.hospitalEntries || [], fromDateYmd, APIM_KEY
  );

  // 4. Match to BUPA
  const bupaMatch = matchConsultantToBupa(nhRaw.name, bupaIndex);

  // 5. Fetch + score BUPA profile
  let bupaResult;
  if (bupaMatch) {
    const bupaRaw = await fetchBupaProfile(bupaMatch.url);
    bupaResult = scoreBUPA(bupaRaw ? { ...bupaRaw, url: bupaMatch.url } : null);
  } else {
    bupaResult = scoreBUPA(null);
  }

  const region = getRegion(nhRaw.hospitals);

  return {
    name: nhRaw.name,
    gmc: nhRaw.gmc,
    specialties: nhRaw.specialties,
    treatments: nhRaw.treatments,
    hospitals: nhRaw.hospitals,
    region,
    nh: {
      url: nhRaw.url,
      overallPass: nhScore.overallPass,
      criteria: nhScore.criteria,
      plainEnglishScore: nhScore.plainEnglishScore,
      fixes: nhScore.fixes,
      booking,
    },
    bupa: bupaResult,
  };
}

function computeStats(records) {
  const total = records.length;
  const nhPass = records.filter(r => r.nh.overallPass).length;
  const bupaFound = records.filter(r => r.bupa.found).length;

  const nhCriteriaKeys = ['photoPass', 'clinicalTermsPass', 'specialtyPass', 'proceduresPass',
    'insurersPass', 'qualificationsPass', 'gmcPass', 'bookOnlinePass'];
  const bupaCriteriaKeys = ['photo', 'specialty', 'treatments', 'feeAssured', 'platinum',
    'openReferral', 'nuffieldHospitalLink', 'nuffieldConsultantLink', 'anaesthetists'];

  const nhRates = {};
  for (const k of nhCriteriaKeys) {
    nhRates[k] = records.filter(r => r.nh.criteria[k]).length;
  }

  const bupaRates = {};
  for (const k of bupaCriteriaKeys) {
    bupaRates[k] = records.filter(r => r.bupa.found && r.bupa.criteria[k]).length;
  }

  const withBooking = records.filter(r => r.nh.booking !== null);
  const noAppts7d = records.filter(r => {
    const b = r.nh.booking;
    return !b || b.firstAvailableDaysAway === null || b.firstAvailableDaysAway > 7;
  }).length;
  const under12in4wk = records.filter(r => {
    const b = r.nh.booking;
    return !b || (b.appointmentsNext4Weeks !== null && b.appointmentsNext4Weeks < 12);
  }).length;

  return {
    total,
    nhPass,
    nhPassRate: total ? ((nhPass / total) * 100).toFixed(1) + '%' : '0%',
    bupaFound,
    bupaFoundRate: total ? ((bupaFound / total) * 100).toFixed(1) + '%' : '0%',
    nhCriteriaCounts: nhRates,
    bupaCriteriaCounts: bupaRates,
    avgNhPlainEnglish: records.length
      ? (records.reduce((s, r) => s + (r.nh.plainEnglishScore || 0), 0) / records.length).toFixed(2)
      : 0,
    bookingStats: {
      withBookingData: withBooking.length,
      noAppts7dCount: noAppts7d,
      noAppts7dRate: total ? ((noAppts7d / total) * 100).toFixed(1) + '%' : '0%',
      under12in4wkCount: under12in4wk,
      under12in4wkRate: total ? ((under12in4wk / total) * 100).toFixed(1) + '%' : '0%',
    },
  };
}

async function main() {
  const opts = parseArgs();
  const startTime = Date.now();

  console.log('=== Consultant Audit Build ===');
  console.log(`Workers: ${opts.workers}, Limit: ${opts.limit || 'all'}`);

  // 1. Fetch NH consultant URL list
  console.log('\n[1/4] Fetching NH consultant URLs from sitemap...');
  let urls = await fetchConsultantUrls();
  console.log(`  Found ${urls.length} URLs`);
  if (opts.limit > 0) {
    urls = urls.slice(0, opts.limit);
    console.log(`  Limited to ${urls.length}`);
  }

  // 2. Build BUPA index
  console.log('\n[2/4] Building BUPA consultant index...');
  const bupaIndex = await buildBupaIndex();

  // 3. Process all consultants
  const fromDateYmd = new Date().toISOString().split('T')[0];
  console.log(`\n[3/4] Processing ${urls.length} consultants (${opts.workers} workers)...`);
  const limit = pLimit(opts.workers);
  const results = [];
  let done = 0;
  let excluded = 0;

  const tasks = urls.map(url => limit(async () => {
    const result = await processConsultant(url, bupaIndex, fromDateYmd);
    done++;
    if (done % 50 === 0 || done === urls.length) {
      process.stdout.write(`  Progress: ${done}/${urls.length} (${excluded} excluded)\r`);
    }
    if (!result) return;
    if (isExcluded(result)) {
      excluded++;
      return;
    }
    results.push(result);
  }));

  await Promise.all(tasks);
  console.log(`\n  Done: ${results.length} included, ${excluded} excluded`);

  // 4. Write output
  console.log('\n[4/4] Writing output...');
  const stats = computeStats(results);
  const output = {
    last_updated: new Date().toISOString(),
    build_duration_seconds: Math.round((Date.now() - startTime) / 1000),
    ...stats,
    records: results,
  };

  mkdirSync(dirname(opts.output), { recursive: true });
  writeFileSync(opts.output, JSON.stringify(output, null, 0));
  console.log(`  Written: ${opts.output} (${(JSON.stringify(output).length / 1024).toFixed(0)} KB)`);
  console.log(`\nDone in ${output.build_duration_seconds}s`);
}

main().catch(e => { console.error(e); process.exit(1); });
