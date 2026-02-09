/**
 * UM LocusZoom / PortalDev API for rsid → position resolution.
 * Used as a fallback when Open Targets search doesn't return results.
 */

import { fetchJSON } from '../utils/fetch-helpers.js';

const PORTALDEV_API = 'https://portaldev.sph.umich.edu/api/v1';

/**
 * Resolve an rsid to genomic position using the omnisearch endpoint.
 * @param {string} rsid  e.g. "rs7903146"
 * @returns {Promise<{chr: string, pos: number} | null>}
 */
export async function resolveRsid(rsid) {
  const url = `${PORTALDEV_API}/annotation/omnisearch/?q=${encodeURIComponent(rsid)}&build=GRCh38`;
  const data = await fetchJSON(url);

  if (!data?.data || data.data.length === 0) return null;

  // The omnisearch endpoint returns various match types; look for a variant match
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
