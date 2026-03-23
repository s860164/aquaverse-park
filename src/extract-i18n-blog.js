#!/usr/bin/env node

/**
 * Extraction script: extracts blog i18n strings and content from existing HTML files
 * into the structured i18n JSON files and content/data files for the Nunjucks build system.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const I18N_DIR = path.join(__dirname, 'i18n');

const LANGUAGES = [
  { code: 'en', dir: '' },
  { code: 'zh-CN', dir: 'zh-CN' },
  { code: 'zh-TW', dir: 'zh-TW' },
  { code: 'ja', dir: 'ja' },
  { code: 'ko', dir: 'ko' },
  { code: 'ru', dir: 'ru' },
  { code: 'hi', dir: 'hi' },
  { code: 'ms', dir: 'ms' },
  { code: 'vi', dir: 'vi' },
  { code: 'de', dir: 'de' },
  { code: 'fr', dir: 'fr' },
  { code: 'lo', dir: 'lo' },
];

const BLOG_POST_SLUGS = [
  'aquaverse-food-guide',
  'aquaverse-review',
  'aquaverse-ticket-prices',
  'aquaverse-vs-ramayana',
  'aquaverse-with-kids',
  'best-hotels-near-aquaverse',
  'best-things-to-do-pattaya',
  'best-time-to-visit-aquaverse',
  'how-to-get-to-aquaverse-from-bangkok',
  'pattaya-couples-guide',
  'pattaya-itinerary-aquaverse',
  'pattaya-kids-activities',
  'pattaya-seniors-guide',
  'pattaya-solo-travel',
  'pattaya-water-parks',
  'why-visit-pattaya',
];

// Simple HTML meta extractor
function extractMeta(html, attr, name) {
  // attr is e.g. 'name' or 'property', name is e.g. 'description' or 'og:title'
  // Use separate patterns for double-quoted and single-quoted content values
  const reDouble = new RegExp(`<meta\\s+${attr}=["']${name}["'][^>]*content="([^"]+)"`, 'i');
  let m = html.match(reDouble);
  if (m) return m[1];
  const reSingle = new RegExp(`<meta\\s+${attr}=["']${name}["'][^>]*content='([^']+)'`, 'i');
  m = html.match(reSingle);
  if (m) return m[1];
  // Also try content first
  const re2Double = new RegExp(`<meta\\s+content="([^"]+)"[^>]*${attr}=["']${name}["']`, 'i');
  m = html.match(re2Double);
  if (m) return m[1];
  const re2Single = new RegExp(`<meta\\s+content='([^']+)'[^>]*${attr}=["']${name}["']`, 'i');
  m = html.match(re2Single);
  if (m) return m[1];
  return '';
}

function extractTitle(html) {
  const m = html.match(/<title>([^<]+)<\/title>/i);
  return m ? m[1] : '';
}

function extractBreadcrumbName(html) {
  // Last <span> in <div class="breadcrumb">
  const bcMatch = html.match(/<div class="breadcrumb"[^>]*>([\s\S]*?)<\/div>/);
  if (!bcMatch) return '';
  const bcHtml = bcMatch[1];
  const spans = [...bcHtml.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)];
  if (spans.length === 0) return '';
  return spans[spans.length - 1][1].trim();
}

function extractOverview(html) {
  // Find the info-card section that contains overview paragraphs (before the blog cards grid)
  // It's the <section class="info-card" ...> that appears before the grid
  // Strategy: find the section that contains <p style="font-size: 1.05rem
  const m = html.match(/<section class="info-card"[^>]*>([\s\S]*?)<\/section>/);
  if (!m) return '';
  return m[1].trim();
}

function extractBlogCards(html) {
  const cards = [];
  const cardRe = /<article class="blog-card info-card"[^>]*>([\s\S]*?)<\/article>/g;
  let m;
  while ((m = cardRe.exec(html)) !== null) {
    const cardHtml = m[1];
    // category: span with letter-spacing style
    const catMatch = cardHtml.match(/<span[^>]*letter-spacing[^>]*>([^<]+)<\/span>/);
    const category = catMatch ? catMatch[1].trim() : '';
    // title: the <a> link text inside <h2>
    const titleMatch = cardHtml.match(/<h2[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/);
    const title = titleMatch ? titleMatch[1].trim() : '';
    // description: the <p style="flex: 1;"> text
    const descMatch = cardHtml.match(/<p style="flex: 1;">([\s\S]*?)<\/p>/);
    const description = descMatch ? descMatch[1].trim() : '';
    // slug: extract from href (works for any language prefix)
    const slugMatch = cardHtml.match(/href="[^"]*\/blog\/([^.]+)\.html"/);
    const slug = slugMatch ? slugMatch[1] : '';
    cards.push({ slug, category, title, description });
  }
  return cards;
}

function extractCta(html) {
  // Find the CTA div: <div class="info-card" style="text-align: center; background: var(--surface); border: 2px solid var(--primary)
  const ctaMatch = html.match(/<div class="info-card" style="text-align: center;[^"]*border: 2px solid var\(--primary\)[^"]*">([\s\S]*?)<\/div>/);
  if (!ctaMatch) return { h2: '', text: '', button: '' };
  const ctaHtml = ctaMatch[1];
  const h2Match = ctaHtml.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
  const pMatch = ctaHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/);
  const btnMatch = ctaHtml.match(/<a[^>]*class="btn btn-primary"[^>]*>([\s\S]*?)<\/a>/);
  return {
    h2: h2Match ? h2Match[1].trim() : '',
    text: pMatch ? pMatch[1].trim() : '',
    button: btnMatch ? btnMatch[1].trim() : '',
  };
}

function extractH1(html) {
  // Find the h1 inside article-header
  const m = html.match(/<header class="article-header"[^>]*>([\s\S]*?)<\/header>/);
  if (!m) return '';
  const h1m = m[1].match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  return h1m ? h1m[1].trim() : '';
}

function extractH1Sub(html) {
  // The <p> after h1 in article-header
  const m = html.match(/<header class="article-header"[^>]*>([\s\S]*?)<\/header>/);
  if (!m) return '';
  const pm = m[1].match(/<p[^>]*>([\s\S]*?)<\/p>/);
  return pm ? pm[1].trim() : '';
}

function extractArticleBody(html) {
  // Find <article class="article-content"> ... </article>
  const m = html.match(/(<article class="article-content">[\s\S]*?<\/article>)/);
  if (!m) return '';
  return m[1];
}

function extractOgImage(html) {
  // <meta property="og:image" content="https://...images/FILENAME">
  const m = html.match(/<meta property="og:image" content="[^"]*\/images\/([^"]+)"/i);
  return m ? m[1] : '';
}

function extractArticleSchema(html) {
  // Find Article type JSON-LD
  const jsonldRe = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let m;
  while ((m = jsonldRe.exec(html)) !== null) {
    try {
      const obj = JSON.parse(m[1].trim());
      if (obj['@type'] === 'Article') {
        return obj;
      }
    } catch (e) {
      // ignore
    }
  }
  return null;
}

function extractBlogIndexStaticData(html) {
  const cards = [];
  const cardRe = /<article class="blog-card info-card"[^>]*>([\s\S]*?)<\/article>/g;
  let m;
  while ((m = cardRe.exec(html)) !== null) {
    const cardHtml = m[1];
    // slug from the href of the <a> link
    const linkMatch = cardHtml.match(/href="\/blog\/([^.]+)\.html"/);
    const slug = linkMatch ? linkMatch[1] : '';
    // date from <time datetime="...">
    const dateMatch = cardHtml.match(/<time datetime="([^"]+)"/);
    const date = dateMatch ? dateMatch[1] : '';
    // readTime from the <span> next to time
    const readTimeMatch = cardHtml.match(/<span>([^<]+)<\/span>\s*<\/div>\s*<\/article>/);
    // fallback: find last <span>
    const spans = [...cardHtml.matchAll(/<span[^>]*>([^<]+)<\/span>/g)];
    const readTime = spans.length > 0 ? spans[spans.length - 1][1].trim() : '';
    cards.push({ slug, date, readTime });
  }
  return { cards };
}

// Main
async function main() {
  console.log('=== Extracting blog i18n and content ===\n');

  // Load all i18n files
  const translations = {};
  for (const lang of LANGUAGES) {
    const filePath = path.join(I18N_DIR, `${lang.code}.json`);
    if (fs.existsSync(filePath)) {
      translations[lang.code] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } else {
      translations[lang.code] = {};
      console.warn(`  Warning: Missing i18n file for ${lang.code}, creating from scratch`);
    }
    // Ensure blog key exists
    if (!translations[lang.code].blog) {
      translations[lang.code].blog = {};
    }
    if (!translations[lang.code].blog.posts) {
      translations[lang.code].blog.posts = {};
    }
  }

  // ========== Extract blog/index.html per language ==========
  console.log('Extracting blog index...');
  for (const lang of LANGUAGES) {
    const htmlPath = lang.code === 'en'
      ? path.join(ROOT, 'blog', 'index.html')
      : path.join(ROOT, lang.dir, 'blog', 'index.html');

    if (!fs.existsSync(htmlPath)) {
      console.warn(`  Warning: Missing ${htmlPath}`);
      continue;
    }

    const html = fs.readFileSync(htmlPath, 'utf8');

    const indexData = {
      title: extractTitle(html),
      metaDescription: extractMeta(html, 'name', 'description'),
      metaKeywords: extractMeta(html, 'name', 'keywords'),
      ogTitle: extractMeta(html, 'property', 'og:title'),
      ogDescription: extractMeta(html, 'property', 'og:description'),
      twitterTitle: extractMeta(html, 'name', 'twitter:title'),
      twitterDescription: extractMeta(html, 'name', 'twitter:description'),
      breadcrumbName: extractBreadcrumbName(html),
      h1: extractH1(html),
      h1Sub: extractH1Sub(html),
      overview: extractOverview(html),
      cta: extractCta(html),
      cards: extractBlogCards(html),
    };

    translations[lang.code].blog.index = indexData;
    console.log(`  Extracted ${lang.code}/blog/index: ${indexData.cards.length} cards`);
  }

  // ========== Extract blog posts per language ==========
  console.log('\nExtracting blog posts...');
  for (const slug of BLOG_POST_SLUGS) {
    for (const lang of LANGUAGES) {
      const htmlPath = lang.code === 'en'
        ? path.join(ROOT, 'blog', `${slug}.html`)
        : path.join(ROOT, lang.dir, 'blog', `${slug}.html`);

      if (!fs.existsSync(htmlPath)) {
        console.warn(`  Warning: Missing ${htmlPath}`);
        continue;
      }

      const html = fs.readFileSync(htmlPath, 'utf8');

      const postData = {
        title: extractTitle(html),
        metaDescription: extractMeta(html, 'name', 'description'),
        metaKeywords: extractMeta(html, 'name', 'keywords'),
        ogTitle: extractMeta(html, 'property', 'og:title'),
        ogDescription: extractMeta(html, 'property', 'og:description'),
        twitterTitle: extractMeta(html, 'name', 'twitter:title'),
        twitterDescription: extractMeta(html, 'name', 'twitter:description'),
        breadcrumbName: extractBreadcrumbName(html),
      };

      translations[lang.code].blog.posts[slug] = postData;
    }
    console.log(`  Extracted post: ${slug}`);
  }

  // ========== Write i18n files ==========
  console.log('\nWriting i18n files...');
  for (const lang of LANGUAGES) {
    const filePath = path.join(I18N_DIR, `${lang.code}.json`);
    fs.writeFileSync(filePath, JSON.stringify(translations[lang.code], null, 2));
    console.log(`  Wrote ${lang.code}.json`);
  }

  // ========== Extract article body content files ==========
  console.log('\nExtracting article body content files...');
  for (const slug of BLOG_POST_SLUGS) {
    for (const lang of LANGUAGES) {
      const htmlPath = lang.code === 'en'
        ? path.join(ROOT, 'blog', `${slug}.html`)
        : path.join(ROOT, lang.dir, 'blog', `${slug}.html`);

      if (!fs.existsSync(htmlPath)) {
        console.warn(`  Warning: Missing ${htmlPath}`);
        continue;
      }

      const html = fs.readFileSync(htmlPath, 'utf8');
      const articleBody = extractArticleBody(html);

      if (!articleBody) {
        console.warn(`  Warning: No article body found in ${htmlPath}`);
        continue;
      }

      const contentDir = path.join(__dirname, 'content', 'blog', slug);
      fs.mkdirSync(contentDir, { recursive: true });
      const contentPath = path.join(contentDir, `${lang.code}.html`);
      fs.writeFileSync(contentPath, articleBody);
    }
    console.log(`  Extracted content: ${slug}`);
  }

  // ========== Extract per-post schema data (English only) ==========
  console.log('\nExtracting per-post schema data...');
  const blogDataDir = path.join(__dirname, 'data', 'blog');
  fs.mkdirSync(blogDataDir, { recursive: true });

  for (const slug of BLOG_POST_SLUGS) {
    const htmlPath = path.join(ROOT, 'blog', `${slug}.html`);
    if (!fs.existsSync(htmlPath)) {
      console.warn(`  Warning: Missing ${htmlPath}`);
      continue;
    }

    const html = fs.readFileSync(htmlPath, 'utf8');
    const schema = extractArticleSchema(html);
    const ogImage = extractOgImage(html);

    const postData = {
      slug,
      ogImage,
      schemaType: 'Article',
      schemaHeadline: schema ? schema.headline || '' : '',
      schemaDescription: schema ? schema.description || '' : '',
      schemaImage: ogImage,
      datePublished: schema ? schema.datePublished || '' : '',
      dateModified: schema ? schema.dateModified || '' : '',
      authorName: schema && schema.author && schema.author['@type'] === 'Person'
        ? schema.author.name || ''
        : (schema && schema.author ? schema.author.name || '' : ''),
      authorUrl: schema && schema.author && schema.author['@type'] === 'Person'
        ? schema.author.url || ''
        : '',
    };

    const dataPath = path.join(blogDataDir, `${slug}.json`);
    fs.writeFileSync(dataPath, JSON.stringify(postData, null, 2));
    console.log(`  Wrote data/blog/${slug}.json`);
  }

  // ========== Extract blog/index.json (static data) ==========
  console.log('\nExtracting blog/index.json...');
  const enIndexPath = path.join(ROOT, 'blog', 'index.html');
  const enIndexHtml = fs.readFileSync(enIndexPath, 'utf8');
  const blogIndexData = extractBlogIndexStaticData(enIndexHtml);
  const indexDataPath = path.join(blogDataDir, 'index.json');
  fs.writeFileSync(indexDataPath, JSON.stringify(blogIndexData, null, 2));
  console.log(`  Wrote data/blog/index.json with ${blogIndexData.cards.length} cards`);

  console.log('\n=== Extraction complete ===');
}

main().catch(console.error);
