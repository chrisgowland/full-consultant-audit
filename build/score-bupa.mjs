import { plainEnglishScoreBUPA } from './readability.mjs';

export function scoreBUPA(bupaData) {
  if (!bupaData) {
    return {
      found: false,
      url: null,
      coreScore: '0/9',
      criteria: {
        photo: null,
        specialty: null,
        treatments: null,
        feeAssured: null,
        platinum: null,
        openReferral: null,
        nuffieldHospitalLink: null,
        nuffieldConsultantLink: null,
        anaesthetists: null,
      },
      plainEnglishScore: null,
      plainEnglishPass: null,
      failedAspects: [],
    };
  }

  const {
    photo, specialty, treatments, feeAssured, platinum,
    openReferral, nuffieldHospitalLink, nuffieldConsultantLink,
    anaesthetists, aboutText, url, hospitalItems,
  } = bupaData;

  const criteria = {
    photo,
    specialty,
    treatments,
    feeAssured,
    platinum,
    openReferral,
    nuffieldHospitalLink,
    nuffieldConsultantLink,
    anaesthetists,
  };

  const passed = Object.values(criteria).filter(Boolean).length;
  const coreScore = `${passed}/9`;

  const failedAspects = Object.entries(criteria)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  const { pass: plainEnglishPass, score: plainEnglishScore } = plainEnglishScoreBUPA(aboutText || '');

  return {
    found: true,
    url,
    coreScore,
    criteria,
    plainEnglishScore,
    plainEnglishPass,
    failedAspects,
    hospitalItems: hospitalItems || [],
  };
}
