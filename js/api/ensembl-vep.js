/**
 * Ensembl VEP REST API client.
 * Docs: https://rest.ensembl.org/documentation/info/vep_id_get
 *
 * Returns variant effect predictions including CADD, Enformer,
 * REVEL, EVE, AlphaMissense, and SpliceAI scores.
 */

import { fetchJSON } from '../utils/fetch-helpers.js';

const VEP_BASE = 'https://rest.ensembl.org';

const VEP_PARAMS = [
  'content-type=application/json',
  'CADD=1',
  'Enformer=1',
  'REVEL=1',
  'EVE=1',
  'AlphaMissense=1',
  'SpliceAI=snv',
  'canonical=1',
  'hgvs=1',
].join('&');

/**
 * Fetch VEP annotations by rsid.
 * @param {string} rsid  e.g. "rs7903146"
 * @returns {Promise<Object|null>}  Parsed VEP result for the first entry
 */
export async function getVepAnnotationByRsid(rsid) {
  const url = `${VEP_BASE}/vep/human/id/${rsid}?${VEP_PARAMS}`;
  const data = await fetchJSON(url);
  if (!Array.isArray(data) || data.length === 0) return null;
  return data[0];
}

/**
 * Fetch VEP annotations by region (chr:pos and allele).
 * @param {string} chr
 * @param {number} pos
 * @param {string} alt  alternate allele
 * @returns {Promise<Object|null>}
 */
export async function getVepAnnotationByRegion(chr, pos, alt) {
  const region = `${chr}:${pos}-${pos}`;
  const url = `${VEP_BASE}/vep/human/region/${region}/${alt}?${VEP_PARAMS}`;
  const data = await fetchJSON(url);
  if (!Array.isArray(data) || data.length === 0) return null;
  return data[0];
}

/**
 * Extract the best annotation scores from VEP transcript consequences.
 * Picks the canonical transcript for the target allele if available,
 * otherwise the transcript with the highest impact / most scores.
 *
 * @param {Object} vepResult  Raw VEP response object
 * @param {string} [targetAlt]  Specific alt allele to filter on
 * @returns {Object}  Annotation scores object
 */
export function extractVepScores(vepResult, targetAlt) {
  if (!vepResult?.transcript_consequences) return buildEmptyScores();

  let tcs = vepResult.transcript_consequences;

  // Filter to target allele if specified
  if (targetAlt) {
    const filtered = tcs.filter(tc => tc.variant_allele === targetAlt);
    if (filtered.length > 0) tcs = filtered;
  }

  // Prefer canonical transcript, fall back to highest-impact
  const canonical = tcs.find(tc => tc.canonical === 1);
  const best = canonical || pickBestTranscript(tcs);

  // Also scan all transcripts for scores that may only appear on non-canonical
  const allScores = aggregateScoresAcrossTranscripts(tcs);

  return {
    cadd: {
      phred: best?.cadd_phred ?? allScores.cadd_phred ?? null,
      raw: best?.cadd_raw ?? allScores.cadd_raw ?? null,
    },
    enformer: {
      sad: best?.enformer_sad ?? allScores.enformer_sad ?? null,
      sar: best?.enformer_sar ?? allScores.enformer_sar ?? null,
    },
    revel: best?.revel ?? allScores.revel ?? null,
    eve: {
      score: best?.eve_score ?? allScores.eve_score ?? null,
      class: best?.eve_class ?? allScores.eve_class ?? null,
    },
    alphaMissense: {
      score: best?.alphamissense?.am_pathogenicity ?? allScores.am_pathogenicity ?? null,
      class: best?.alphamissense?.am_class ?? allScores.am_class ?? null,
    },
    spliceAI: extractSpliceAI(best?.spliceai, allScores.spliceai),
    // Context
    geneSymbol: best?.gene_symbol || null,
    consequence: best?.consequence_terms?.[0] || null,
    hgvsc: best?.hgvsc || null,
    hgvsp: best?.hgvsp || null,
    impact: best?.impact || null,
  };
}

/**
 * Pick the transcript with the most annotation data / highest impact.
 */
function pickBestTranscript(tcs) {
  if (!tcs || tcs.length === 0) return null;

  const impactOrder = { HIGH: 4, MODERATE: 3, LOW: 2, MODIFIER: 1 };

  return tcs.reduce((best, tc) => {
    const bScore = impactOrder[best.impact] || 0;
    const tScore = impactOrder[tc.impact] || 0;
    if (tScore > bScore) return tc;
    if (tScore === bScore) {
      // Prefer whichever has more annotation fields
      const bCount = countScores(best);
      const tCount = countScores(tc);
      return tCount > bCount ? tc : best;
    }
    return best;
  });
}

function countScores(tc) {
  let n = 0;
  if (tc.cadd_phred != null) n++;
  if (tc.revel != null) n++;
  if (tc.alphamissense) n++;
  if (tc.enformer_sad != null) n++;
  if (tc.spliceai) n++;
  if (tc.eve_score != null) n++;
  return n;
}

/**
 * Scan all transcripts and collect the first non-null value for each score.
 */
function aggregateScoresAcrossTranscripts(tcs) {
  const agg = {};
  for (const tc of tcs) {
    if (agg.cadd_phred == null && tc.cadd_phred != null) agg.cadd_phred = tc.cadd_phred;
    if (agg.cadd_raw == null && tc.cadd_raw != null) agg.cadd_raw = tc.cadd_raw;
    if (agg.enformer_sad == null && tc.enformer_sad != null) agg.enformer_sad = tc.enformer_sad;
    if (agg.enformer_sar == null && tc.enformer_sar != null) agg.enformer_sar = tc.enformer_sar;
    if (agg.revel == null && tc.revel != null) agg.revel = tc.revel;
    if (agg.eve_score == null && tc.eve_score != null) agg.eve_score = tc.eve_score;
    if (agg.eve_class == null && tc.eve_class != null) agg.eve_class = tc.eve_class;
    if (agg.am_pathogenicity == null && tc.alphamissense?.am_pathogenicity != null) {
      agg.am_pathogenicity = tc.alphamissense.am_pathogenicity;
      agg.am_class = tc.alphamissense.am_class;
    }
    if (!agg.spliceai && tc.spliceai) agg.spliceai = tc.spliceai;
  }
  return agg;
}

/**
 * Extract SpliceAI delta scores. Returns the max delta score and individual scores.
 */
function extractSpliceAI(primary, fallback) {
  const sai = primary || fallback || null;
  if (!sai) return { maxDS: null, DS_AG: null, DS_AL: null, DS_DG: null, DS_DL: null };

  const DS_AG = sai.DS_AG ?? null;
  const DS_AL = sai.DS_AL ?? null;
  const DS_DG = sai.DS_DG ?? null;
  const DS_DL = sai.DS_DL ?? null;

  const vals = [DS_AG, DS_AL, DS_DG, DS_DL].filter(v => v != null);
  const maxDS = vals.length > 0 ? Math.max(...vals) : null;

  return { maxDS, DS_AG, DS_AL, DS_DG, DS_DL };
}

function buildEmptyScores() {
  return {
    cadd: { phred: null, raw: null },
    enformer: { sad: null, sar: null },
    revel: null,
    eve: { score: null, class: null },
    alphaMissense: { score: null, class: null },
    spliceAI: { maxDS: null, DS_AG: null, DS_AL: null, DS_DG: null, DS_DL: null },
    geneSymbol: null,
    consequence: null,
    hgvsc: null,
    hgvsp: null,
    impact: null,
  };
}
