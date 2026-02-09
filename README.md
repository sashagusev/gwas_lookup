# GWAS Lookup

Claude project for GWAS variant search. The initial prompt:

*I want you to code up a web-site for querying GWAS association interpretations. Given a SNP (rsid or physical position), the web-site should query the following sources: https://pheweb.org/UKB-TOPMed/ to get other associated traits; https://gtexportal.org/home/index.html and https://fivex.sph.umich.edu/ for eQTL / gene associations; and opentargets (https://platform.opentargets.org/) . For all nearest genes, it should additionally query OMIM (https://www.omim.org/) for rare disease associations. Ideally it would be implemented in a light-weight client side / javascript implementation that can be hosted in github. Can this be done? If not, recommend inexpensive alternatives that do require hosting.*

# Claude Memory

## Architecture
- Client-side JS app (no framework), ES6 modules
- `index.html` + `style.css` + `js/` directory
- API modules in `js/api/`, UI in `js/ui/`, utils in `js/utils/`

## Key Files
- `js/app.js` - Main orchestration, search flow, section rendering
- `js/api/dbsnp.js` - Variant resolution via Ensembl REST API (GRCh37 + GRCh38)
- `js/api/opentargets.js` - GraphQL queries for variant details, credible sets
- `js/api/pheweb-bbj.js` - BBJ uses GRCh37 coordinates
- `js/ui/render.js` - DOM helpers (showLoading, updateSummary, etc.)
- `js/ui/tables.js` - Sortable/filterable table component

## Search Flow
1. User enters rsID OR position+build (hg19/hg38)
2. Resolve via Ensembl REST API to get positions on both GRCh37 and GRCh38
3. Build Open Targets variant ID from GRCh38 coords
4. Parallel fetch 9 sections with correct coordinates per database

## Database Build Requirements
- GRCh38: Open Targets, PheWeb UKB, FinnGen, GTEx
- GRCh37: Biobank Japan (BBJ)
- rsID: eQTL Catalogue, VEP (can also use region)

## Ensembl REST API
- GRCh38: `https://rest.ensembl.org`
- GRCh37: `https://grch37.rest.ensembl.org`
- Variation endpoint: `/variation/human/{rsid}` → mappings with allele_string
- Overlap endpoint: `/overlap/region/human/{chr}:{pos}-{pos}?feature=variation` → array with alleles

## URL Hash Format
- `#rsid=rs7903146`
- `#pos=10:112998590&build=hg38`
- Legacy: `#variant=...` still supported
