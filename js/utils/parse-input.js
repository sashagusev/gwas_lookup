/**
 * Parse user input into a structured variant query.
 *
 * Accepted formats:
 *   rs7903146              → { type: 'rsid', rsid: 'rs7903146' }
 *   chr10:112998590        → { type: 'position', chr: '10', pos: 112998590 }
 *   10:112998590           → { type: 'position', chr: '10', pos: 112998590 }
 *   10:112998590:C:T       → { type: 'full', chr: '10', pos: 112998590, ref: 'C', alt: 'T' }
 *   10_112998590_C_T       → { type: 'full', chr: '10', pos: 112998590, ref: 'C', alt: 'T' }
 */

const RSID_RE = /^rs\d+$/i;
const POS_RE = /^(?:chr)?(\d{1,2}|[XY]):(\d+)$/i;
const FULL_COLON_RE = /^(?:chr)?(\d{1,2}|[XY]):(\d+):([ACGT]+):([ACGT]+)$/i;
const FULL_UNDERSCORE_RE = /^(?:chr)?(\d{1,2}|[XY])_(\d+)_([ACGT]+)_([ACGT]+)$/i;

export function parseInput(raw) {
  const input = raw.trim();
  if (!input) return null;

  // rsid
  if (RSID_RE.test(input)) {
    return { type: 'rsid', rsid: input.toLowerCase() };
  }

  // full variant with colons  10:112998590:C:T
  let m = input.match(FULL_COLON_RE);
  if (m) {
    return {
      type: 'full',
      chr: m[1].toUpperCase(),
      pos: parseInt(m[2], 10),
      ref: m[3].toUpperCase(),
      alt: m[4].toUpperCase(),
    };
  }

  // full variant with underscores  10_112998590_C_T
  m = input.match(FULL_UNDERSCORE_RE);
  if (m) {
    return {
      type: 'full',
      chr: m[1].toUpperCase(),
      pos: parseInt(m[2], 10),
      ref: m[3].toUpperCase(),
      alt: m[4].toUpperCase(),
    };
  }

  // position only  chr10:112998590
  m = input.match(POS_RE);
  if (m) {
    return {
      type: 'position',
      chr: m[1].toUpperCase(),
      pos: parseInt(m[2], 10),
    };
  }

  return null;
}

/**
 * Build an Open Targets-style variant ID: "10_112998590_C_T"
 */
export function toVariantId(chr, pos, ref, alt) {
  return `${chr}_${pos}_${ref}_${alt}`;
}

/**
 * Parse an Open Targets variant ID into components.
 */
export function parseVariantId(variantId) {
  const parts = variantId.split('_');
  if (parts.length !== 4) return null;
  return {
    chr: parts[0],
    pos: parseInt(parts[1], 10),
    ref: parts[2],
    alt: parts[3],
  };
}
