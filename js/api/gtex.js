/**
 * GTEx Portal v2 API client.
 * Docs: https://gtexportal.org/api/v2
 */

import { fetchJSON } from '../utils/fetch-helpers.js';

const GTEX_API = 'https://gtexportal.org/api/v2';

/**
 * Fetch single-tissue eQTL associations for a variant.
 * GTEx v2 requires variantId in format "chr10_112998590_C_T_b38".
 * @param {object} opts
 * @param {string} opts.chr  Chromosome (e.g. "10")
 * @param {number} opts.pos  Position
 * @param {string} opts.ref  Reference allele
 * @param {string} opts.alt  Alternate allele
 * @returns {Promise<Array>}  Array of eQTL association objects
 */
export async function getEqtls({ chr, pos, ref, alt }) {
  const variantId = `chr${chr}_${pos}_${ref}_${alt}_b38`;
  const url = `${GTEX_API}/association/singleTissueEqtl?variantId=${encodeURIComponent(variantId)}`;
  const data = await fetchJSON(url);
  return data?.data || [];
}

/**
 * Build a link to the GTEx variant page.
 * @param {string} rsid
 * @returns {string}
 */
export function getGtexVariantUrl(rsid) {
  return `https://gtexportal.org/home/snp/${rsid}`;
}

/**
 * Format tissue name for display (replace underscores, title case).
 */
export function formatTissueName(tissueSiteDetailId) {
  if (!tissueSiteDetailId) return '';
  return tissueSiteDetailId
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}
