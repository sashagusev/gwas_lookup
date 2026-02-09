/**
 * Variant resolution via Ensembl REST API (backed by dbSNP data).
 *
 * Resolves rsIDs to genomic positions on GRCh37/GRCh38 and vice versa.
 * Uses both the main (GRCh38) and GRCh37 Ensembl REST servers.
 */

import { fetchJSON } from '../utils/fetch-helpers.js';

const ENSEMBL_GRCh38 = 'https://rest.ensembl.org';
const ENSEMBL_GRCh37 = 'https://grch37.rest.ensembl.org';

function serverFor(build) {
  return build === 'GRCh37' || build === 'hg19'
    ? ENSEMBL_GRCh37
    : ENSEMBL_GRCh38;
}

function assemblyCmp(build) {
  return build === 'GRCh37' || build === 'hg19' ? 'GRCh37' : 'GRCh38';
}

// ── rsID lookup ──────────────────────────────────────────

/**
 * Look up an rsID via Ensembl variation endpoint for a given build.
 *
 * @param {string} rsid  e.g. "rs7903146"
 * @param {string} build "GRCh38"|"GRCh37"|"hg38"|"hg19"
 * @returns {Promise<{chr: string, pos: number, ref: string, alts: string[]} | null>}
 */
export async function lookupRsid(rsid, build = 'GRCh38') {
  const server = serverFor(build);
  const asm = assemblyCmp(build);
  const url = `${server}/variation/human/${encodeURIComponent(rsid)}?content-type=application/json`;

  const data = await fetchJSON(url, { timeout: 15000 });
  if (!data?.mappings?.length) return null;

  for (const m of data.mappings) {
    if (m.assembly_name === asm && m.seq_region_name && m.start != null) {
      const alleles = m.allele_string ? m.allele_string.split('/') : [];
      return {
        chr: String(m.seq_region_name),
        pos: m.start,
        ref: alleles[0] || null,
        alts: alleles.slice(1),
      };
    }
  }

  return null;
}

// ── Position lookup ──────────────────────────────────────

/**
 * Look up variants at a genomic position via Ensembl overlap endpoint.
 *
 * @param {string} chr   e.g. "10"
 * @param {number} pos   e.g. 112998590
 * @param {string} build "GRCh38"|"GRCh37"|"hg38"|"hg19"
 * @returns {Promise<{rsid: string, ref: string, alts: string[]} | null>}
 */
export async function lookupPosition(chr, pos, build = 'GRCh38') {
  const server = serverFor(build);
  const url = `${server}/overlap/region/human/${chr}:${pos}-${pos}?feature=variation;content-type=application/json`;

  const data = await fetchJSON(url, { timeout: 15000 });
  if (!Array.isArray(data) || data.length === 0) return null;

  // Prefer the first variant with an rs-prefixed ID
  for (const v of data) {
    if (v.id?.startsWith('rs')) {
      const alleles = Array.isArray(v.alleles) ? v.alleles : [];
      return {
        rsid: v.id,
        ref: alleles[0] || null,
        alts: alleles.slice(1),
      };
    }
  }

  return null;
}

// ── Full resolution helper ───────────────────────────────

/**
 * Resolve a variant from an rsID, returning positions on both builds.
 *
 * @param {string} rsid
 * @returns {Promise<{rsid, chr38, pos38, chr37, pos37, ref, alts}>}
 */
export async function resolveRsidBothBuilds(rsid) {
  const [r38, r37] = await Promise.allSettled([
    lookupRsid(rsid, 'GRCh38'),
    lookupRsid(rsid, 'GRCh37'),
  ]);

  const g38 = r38.status === 'fulfilled' ? r38.value : null;
  const g37 = r37.status === 'fulfilled' ? r37.value : null;

  return {
    rsid,
    chr38: g38?.chr || null,
    pos38: g38?.pos || null,
    chr37: g37?.chr || null,
    pos37: g37?.pos || null,
    ref: g38?.ref || g37?.ref || null,
    alts: g38?.alts?.length ? g38.alts : (g37?.alts || []),
  };
}

/**
 * Resolve a variant from a genomic position + build,
 * returning rsid, positions on both builds, and alleles.
 *
 * @param {string} chr
 * @param {number} pos
 * @param {string} build  "hg38"|"hg19"|"GRCh38"|"GRCh37"
 * @returns {Promise<{rsid, chr38, pos38, chr37, pos37, ref, alts} | null>}
 */
export async function resolvePositionBothBuilds(chr, pos, build) {
  const isHg19 = build === 'hg19' || build === 'GRCh37';
  const otherBuild = isHg19 ? 'GRCh38' : 'GRCh37';

  // Step 1: find rsid + alleles at this position
  const posResult = await lookupPosition(chr, pos, build);
  if (!posResult?.rsid) return null;

  // Step 2: resolve the other build using the rsid
  const otherResult = await lookupRsid(posResult.rsid, otherBuild).catch(() => null);

  if (isHg19) {
    return {
      rsid: posResult.rsid,
      chr38: otherResult?.chr || null,
      pos38: otherResult?.pos || null,
      chr37: chr,
      pos37: pos,
      ref: otherResult?.ref || posResult.ref,
      alts: otherResult?.alts?.length ? otherResult.alts : posResult.alts,
    };
  } else {
    return {
      rsid: posResult.rsid,
      chr38: chr,
      pos38: pos,
      chr37: otherResult?.chr || null,
      pos37: otherResult?.pos || null,
      ref: posResult.ref,
      alts: posResult.alts,
    };
  }
}
