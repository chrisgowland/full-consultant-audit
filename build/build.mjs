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

const __dirname = dirname(fileURLToPath(import.meta.url));

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

async function processConsultant(url, bupaIndex) {
  // 1. Fetch + parse NH profile
  const nhRaw = await parseConsultantProfile(url);
  if (!nhRaw || !nhRaw.name) return null;

  // 2. Score NH criteria
  const nhScore = scoreNH(nhRaw);

  // 3. Match to BUPA
  const bupaMatch = matchConsultantToBupa(nhRaw.name, bupaIndex);

  // 4. Fetch + score BUPA profile
  let bupaResult;
  if (bupaMatch) {
    const bupaRaw = await fetchBupaProfile(bupaMatch.url);
    bupaResult = scoreBUPA(bupaRaw ? { ...bupaRaw, url: bupaMatch.url } : null);
  } else {
    bupaResult = scoreBUPA(null);
  }

  // 5. Derive shared metadata
  const hospitals = nhRaw.hospitals.length ? nhRaw.hospitals :
    (bupaResult.found ? bupaResult.criteria && [] : []);
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
      booking: null, // populated by booking API when available
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
  console.log(`\n[3/4] Processing ${urls.length} consultants (${opts.workers} workers)...`);
  const limit = pLimit(opts.workers);
  const results = [];
  let done = 0;
  let excluded = 0;

  const tasks = urls.map(url => limit(async () => {
    const result = await processConsultant(url, bupaIndex);
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
