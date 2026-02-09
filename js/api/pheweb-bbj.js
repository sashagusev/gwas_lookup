/**
 * PheWeb Biobank Japan (BBJ) API client.
 * Base: https://pheweb.jp
 *
 * BBJ uses GRCh37 coordinates. We resolve GRCh37 position via portaldev,
 * then combine with ref/alt alleles (which are the same across builds for SNPs).
 */

import { fetchJSON } from '../utils/fetch-helpers.js';

const BBJ_BASE = 'https://pheweb.jp';
const PORTALDEV_API = 'https://portaldev.sph.umich.edu/api/v1';

/**
 * Resolve an rsid to GRCh37 position via portaldev.
 * @param {string} rsid  e.g. "rs7903146"
 * @returns {Promise<{chr: string, pos: number} | null>}
 */
export async function resolveToGRCh37(rsid) {
  const url = `${PORTALDEV_API}/annotation/omnisearch/?q=${encodeURIComponent(rsid)}&build=GRCh37`;
  const data = await fetchJSON(url);

  if (!data?.data || data.data.length === 0) return null;

  for (const item of data.data) {
    if (item.chrom && item.start) {
      return {
        chr: String(item.chrom).replace(/^chr/i, ''),
        pos: parseInt(item.start, 10),
      };
    }
  }

  return null;
}

/**
 * Fetch phenotype associations for a variant from BBJ.
 * @param {string} variantStr  BBJ variant string, e.g. "10:114758349-C-T"
 * @returns {Promise<Array>}
 */
export async function getBBJPheWAS(variantStr) {
  const url = `${BBJ_BASE}/api/variant/${variantStr}`;
  const data = await fetchJSON(url);

  if (data == null) return [];
  if (Array.isArray(data)) return data;
  if (data?.phenos) return data.phenos;
  return [];
}

/**
 * Build a link to the BBJ PheWeb variant page.
 * @param {string} variantStr  e.g. "10:114758349-C-T"
 * @returns {string}
 */
export function getBBJVariantUrl(variantStr) {
  return `${BBJ_BASE}/variant/${variantStr}`;
}
