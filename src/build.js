#!/usr/bin/env node

/**
 * Build script: renders Nunjucks templates × i18n translations → static HTML
 *
 * Usage:
 *   node src/build.js              # build all pages for all languages
 *   node src/build.js --page faq   # build only FAQ page
 */

const nunjucks = require('nunjucks');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TEMPLATES_DIR = path.join(__dirname, 'templates');
const I18N_DIR = path.join(__dirname, 'i18n');
const SITE = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'site.json'), 'utf8'));

// Parse CLI args
const args = process.argv.slice(2);
const pageFilter = args.indexOf('--page') !== -1 ? args[args.indexOf('--page') + 1] : null;

// Configure Nunjucks
const env = new nunjucks.Environment(
  new nunjucks.FileSystemLoader(TEMPLATES_DIR, { noCache: true }),
  { autoescape: false, trimBlocks: false, lstripBlocks: false }
);

// Custom filter: dump JSON with indentation
env.addFilter('dump', function (obj) {
  return JSON.stringify(obj, null, 4);
});

// Available page templates
const PAGE_CONFIGS = {
  faq: {
    template: 'pages/faq.njk',
    slug: 'faq.html',
  },
};

// Footer guide blog post slugs (same order as labels in i18n files)
const FOOTER_GUIDES_SLUGS = [
  'aquaverse-vs-ramayana.html',
  'aquaverse-with-kids.html',
  'how-to-get-to-aquaverse-from-bangkok.html',
  'aquaverse-ticket-prices.html',
  'aquaverse-review.html',
];

// Load all i18n files
function loadI18n() {
  const translations = {};
  for (const lang of SITE.languages) {
    const filePath = path.join(I18N_DIR, `${lang.code}.json`);
    if (fs.existsSync(filePath)) {
      translations[lang.code] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } else {
      console.warn(`  Warning: Missing i18n file for ${lang.code}`);
    }
  }
  return translations;
}

// Strip HTML tags for Schema.org plain text
function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&amp;/g, '&')
    .replace(/&rarr;/g, '→')
    .replace(/&bull;/g, '•')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Build FAQPage schema from FAQ data
function buildFaqSchema(categories) {
  const mainEntity = [];
  for (const cat of categories) {
    for (const q of cat.questions) {
      mainEntity.push({
        '@type': 'Question',
        name: q.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: stripHtml(q.answer),
        },
      });
    }
  }
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity,
  };
}

// Format number with commas
function formatNumber(n) {
  return n.toLocaleString('en-US');
}

// Load current prices from data/prices.json
function loadPrices() {
  const pricesPath = path.join(ROOT, 'data', 'prices.json');
  if (fs.existsSync(pricesPath)) {
    return JSON.parse(fs.readFileSync(pricesPath, 'utf8'));
  }
  // Fallback defaults
  return {
    packages: [
      { id: 'standard-admission', priceTHB: 1176, gatePrice: 1595 },
    ],
  };
}

function buildPage(pageKey, pageConfig) {
  const translations = loadI18n();
  const prices = loadPrices();
  const standardPkg = prices.packages.find(p => p.id === 'standard-admission') || prices.packages[0];
  const stickyPrice = standardPkg.priceTHB;
  const stickyOriginalPrice = standardPkg.gatePrice || 1595;

  let built = 0;

  for (const lang of SITE.languages) {
    const t = translations[lang.code];
    if (!t) continue;

    const page = { slug: pageConfig.slug };

    // Build schema
    let schemaFaq = null;
    if (pageKey === 'faq' && t.faq && t.faq.categories) {
      schemaFaq = buildFaqSchema(t.faq.categories);
    }

    const context = {
      site: SITE,
      lang,
      t,
      page,
      activePage: pageKey,
      schemaFaq,
      stickyPrice,
      stickyOriginalPrice,
      stickyPriceFormatted: formatNumber(stickyPrice),
      stickyOriginalPriceFormatted: formatNumber(stickyOriginalPrice),
      footerGuidesSlugs: FOOTER_GUIDES_SLUGS,
    };

    try {
      const html = env.render(pageConfig.template, context);

      // Determine output path
      const outDir = lang.code === 'en' ? ROOT : path.join(ROOT, lang.code);
      fs.mkdirSync(outDir, { recursive: true });
      const outPath = path.join(outDir, pageConfig.slug);

      fs.writeFileSync(outPath, html);
      console.log(`  Built ${lang.code}/${pageConfig.slug}`);
      built++;
    } catch (err) {
      console.error(`  ERROR building ${lang.code}/${pageConfig.slug}:`, err.message);
    }
  }

  return built;
}

// Main
function main() {
  console.log('=== Building site ===\n');

  let totalBuilt = 0;

  for (const [key, config] of Object.entries(PAGE_CONFIGS)) {
    if (pageFilter && key !== pageFilter) continue;
    console.log(`Building ${key}...`);
    totalBuilt += buildPage(key, config);
  }

  console.log(`\n=== Done: ${totalBuilt} files built ===`);
}

main();
