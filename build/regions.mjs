// Hospital name → region mapping based on Nuffield Health's North/Central/South geography
const NORTH_PATTERNS = [
  /aberdeen/i,
  /bradford/i,
  /chester/i,
  /derby/i,
  /edinburgh/i,
  /glasgow/i,
  /leeds/i,
  /liverpool/i,
  /manchester|mihp/i,
  /newcastle/i,
  /sheffield/i,
  /tees|teesside|middlesbrough/i,
  /warwick/i,
  /york(?!shire)/i,
];

const CENTRAL_PATTERNS = [
  /birmingham/i,
  /cambridge/i,
  /coventry/i,
  /leicester/i,
  /northampton/i,
  /nottingham/i,
  /oxford/i,
  /shrewsbury/i,
  /stoke/i,
];

export function getRegion(hospitals) {
  const haystack = hospitals.join(' ').toLowerCase();
  for (const p of NORTH_PATTERNS) {
    if (p.test(haystack)) return 'North';
  }
  for (const p of CENTRAL_PATTERNS) {
    if (p.test(haystack)) return 'Central';
  }
  if (haystack) return 'South';
  return '';
}
