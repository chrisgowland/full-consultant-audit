import { plainEnglishScoreNH } from './readability.mjs';

const CLINICAL_TERMS = /\b(surgery|surgical|procedure|clinic|diagnosis|treatment|consultation|intervention|laparoscopic|arthroscopy|endoscopy|oncology|cardiology|orthopaedic|orthopedic|fracture|biopsy|resection|excision|reconstruction|repair|replacement|removal|implant|injection|infusion|therapy|rehabilitation|assessment|examination|screening|operative|minimally invasive)\b/i;

export function scoreNH(consultant) {
  const { gmc, specialties, treatments, insurers, qualifications, photoUrl, aboutText, bookOnline } = consultant;

  const photoPass = !!(photoUrl && !/\b(placeholder|default|avatar|blank|no[-_ ]?image)\b/i.test(photoUrl));
  const clinicalTermsPass = CLINICAL_TERMS.test((aboutText || '') + ' ' + treatments.join(' '));
  const specialtyPass = specialties.length > 0;
  const proceduresPass = treatments.length > 0;
  const insurersPass = insurers.length > 0;
  const qualificationsPass = qualifications.length > 0;
  const gmcPass = !!(gmc && gmc.trim().length > 0);
  const bookOnlinePass = !!bookOnline;

  const overallPass = photoPass && clinicalTermsPass && specialtyPass && proceduresPass &&
    insurersPass && qualificationsPass && gmcPass && bookOnlinePass;

  const plainEnglishScore = plainEnglishScoreNH(aboutText || '');

  const fixes = [];
  if (!photoPass) fixes.push('Add profile photo');
  if (!clinicalTermsPass) fixes.push('Add clinical terminology');
  if (!specialtyPass) fixes.push('Add specialty');
  if (!proceduresPass) fixes.push('Add procedures/treatments');
  if (!insurersPass) fixes.push('Add accepted insurers');
  if (!qualificationsPass) fixes.push('Add qualifications');
  if (!gmcPass) fixes.push('Add GMC number');
  if (!bookOnlinePass) fixes.push('Enable online booking');

  return {
    criteria: {
      photoPass, clinicalTermsPass, specialtyPass, proceduresPass,
      insurersPass, qualificationsPass, gmcPass, bookOnlinePass,
    },
    overallPass,
    plainEnglishScore,
    fixes,
  };
}
