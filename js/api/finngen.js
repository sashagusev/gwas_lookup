/**
 * FinnGen r12 PheWeb API client.
 * Base: https://r12.finngen.fi
 *
 * Uses GRCh38 coordinates. Variant format: chr:pos-ref-alt
 */

import { fetchJSON } from '../utils/fetch-helpers.js';

const FINNGEN_BASE = 'https://r12.finngen.fi';

/**
 * Fetch phenotype associations for a variant from FinnGen.
 * @param {string} chr
 * @param {number} pos
 * @param {string} ref
 * @param {string} alt
 * @returns {Promise<Array>}  Array of phenotype association objects
 */
export async function getFinnGenPheWAS(chr, pos, ref, alt) {
  const variantStr = `${chr}:${pos}-${ref}-${alt}`;
  const url = `${FINNGEN_BASE}/api/variant/${variantStr}`;
  const data = await fetchJSON(url);

  if (data == null) return [];
  if (data?.results) return data.results;
  if (Array.isArray(data)) return data;
  return [];
}

/**
 * Build a link to the FinnGen variant page.
 */
export function getFinnGenVariantUrl(chr, pos, ref, alt) {
  return `${FINNGEN_BASE}/variant/${chr}:${pos}-${ref}-${alt}`;
}
