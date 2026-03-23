#!/usr/bin/env node

/**
 * One-time extraction script: pulls translatable strings from existing tips.html
 * files across all 12 languages and merges them into src/i18n/{lang}.json under "tips" key.
 *
 * Run once: node src/extract-i18n-tips.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const I18N_DIR = path.join(__dirname, 'i18n');
const SITE = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'site.json'), 'utf8'));

function getFilePath(langCode) {
  if (langCode === 'en') return path.join(ROOT, 'tips.html');
  return path.join(ROOT, langCode, 'tips.html');
}

function warn(lang, msg) {
  console.warn(`  [WARN][${lang}] ${msg}`);
}

function extractTitle(html) {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  return m ? m[1].trim() : '';
}

function extractMeta(html, name) {
  const patterns = [
    new RegExp(`<meta\\s+name="${name}"\\s+content="([^"]*)"`, 'i'),
    new RegExp(`<meta\\s+property="${name}"\\s+content="([^"]*)"`, 'i'),
    new RegExp(`<meta\\s+content="([^"]*)"\\s+name="${name}"`, 'i'),
    new RegExp(`<meta\\s+content="([^"]*)"\\s+property="${name}"`, 'i'),
  ];
  for (const pat of patterns) {
    const m = html.match(pat);
    if (m) return m[1];
  }
  return '';
}

function extractBreadcrumbCurrent(html) {
  const m = html.match(/<span\s+aria-current="page">([^<]+)<\/span>/);
  return m ? m[1].trim() : '';
}

function extractHeroBlock(html) {
  const heroMatch = html.match(/<section class="hero hero-sm"[^>]*>([\s\S]*?)<\/section>/);
  if (!heroMatch) return { h1: '', h1Span: '', heroSub: '' };
  const heroHtml = heroMatch[1];

  const h1Match = heroHtml.match(/<h1>([\s\S]*?)<\/h1>/);
  let h1 = '';
  let h1Span = '';
  if (h1Match) {
    const h1Content = h1Match[1];
    const spanMatch = h1Content.match(/<span>([\s\S]*?)<\/span>/);
    h1Span = spanMatch ? spanMatch[1].trim() : '';
    h1 = h1Content.replace(/<span>[\s\S]*?<\/span>/, '').trim();
  }

  const subMatch = heroHtml.match(/<p class="hero-sub">([\s\S]*?)<\/p>/);
  const heroSub = subMatch ? subMatch[1].trim() : '';

  return { h1, h1Span, heroSub };
}

function extractTldr(html) {
  const tldrMatch = html.match(/<div class="tldr-box">([\s\S]*?)<\/div>/);
  if (!tldrMatch) return [];

  const tldrHtml = tldrMatch[1];
  const items = [];
  const liRe = /<li>([\s\S]*?)<\/li>/g;
  let m;
  while ((m = liRe.exec(tldrHtml)) !== null) {
    const liHtml = m[1].trim();
    const strongMatch = liHtml.match(/^<strong>([\s\S]*?)<\/strong>([\s\S]*)$/);
    if (strongMatch) {
      items.push({
        strong: strongMatch[1].trim(),
        text: strongMatch[2].trim(),
      });
    } else {
      items.push({ strong: '', text: liHtml });
    }
  }
  return items;
}

function extractToc(html) {
  // The TOC is always the second section-sm (first is TL;DR)
  const sectionSmRe = /<section class="section-sm"[^>]*>/g;
  let m;
  let count = 0;
  let tocStartIdx = -1;
  while ((m = sectionSmRe.exec(html)) !== null) {
    count++;
    if (count === 2) {
      tocStartIdx = m.index;
      break;
    }
  }
  if (tocStartIdx === -1) return { heading: '', items: [] };

  // Find end of this section
  const afterOpenTag = html.indexOf('>', tocStartIdx) + 1;
  let depth = 1;
  let i = afterOpenTag;
  while (i < html.length && depth > 0) {
    const nextOpen = html.indexOf('<section', i);
    const nextClose = html.indexOf('</section>', i);
    if (nextClose === -1) break;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      i = nextOpen + 1;
    } else {
      depth--;
      if (depth === 0) break;
      i = nextClose + 1;
    }
  }
  const tocEndIdx = html.indexOf('</section>', i) + '</section>'.length;
  const tocHtml = html.substring(tocStartIdx, tocEndIdx);

  const h2Match = tocHtml.match(/<h2[^>]*>([^<]+)<\/h2>/);
  const heading = h2Match ? h2Match[1].trim() : '';

  const items = [];
  // Items may contain HTML entities (e.g. &mdash;), so match innerHTML of <a>
  const liRe = /<li><a[^>]*>([\s\S]*?)<\/a><\/li>/g;
  let lm;
  while ((lm = liRe.exec(tocHtml)) !== null) {
    items.push(lm[1].trim());
  }

  return { heading, items };
}

/**
 * Extract the inner HTML of a div by scanning for nested div balance.
 * Starts scanning from startIdx (which should point right after the opening tag).
 */
function extractDivInnerHtml(html, startIdx) {
  let depth = 1;
  let i = startIdx;
  while (i < html.length && depth > 0) {
    const nextOpen = html.indexOf('<div', i);
    const nextClose = html.indexOf('</div>', i);
    if (nextClose === -1) break;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      i = nextOpen + 4;
    } else {
      depth--;
      if (depth === 0) {
        return html.substring(startIdx, nextClose).trim();
      }
      i = nextClose + 6;
    }
  }
  return '';
}

/**
 * Extract a section by id, returning the full section HTML.
 * Falls back to finding by aria-label keyword if id is not found (e.g. ms lang uses translated ids).
 */
function extractSection(html, sectionId, ariaLabelKeyword) {
  const patterns = [
    `<section class="section" id="${sectionId}"`,
    `<section class="section section-gray" id="${sectionId}"`,
    `<section class="section section-sm" id="${sectionId}"`,
  ];
  let startIdx = -1;
  for (const pat of patterns) {
    startIdx = html.indexOf(pat);
    if (startIdx !== -1) break;
  }
  // Fallback: any section with that id
  if (startIdx === -1) {
    const re = new RegExp(`<section[^>]+id="${sectionId}"`, 'i');
    const m = re.exec(html);
    if (m) startIdx = m.index;
  }
  // Fallback: find by aria-label keyword (for languages that translate IDs, e.g. ms)
  if (startIdx === -1 && ariaLabelKeyword) {
    const re = new RegExp(`<section[^>]+aria-label="[^"]*${ariaLabelKeyword}[^"]*"`, 'i');
    const m = re.exec(html);
    if (m) startIdx = m.index;
  }
  if (startIdx === -1) return '';

  let depth = 1;
  let i = html.indexOf('>', startIdx) + 1;
  while (i < html.length && depth > 0) {
    const nextOpen = html.indexOf('<section', i);
    const nextClose = html.indexOf('</section>', i);
    if (nextClose === -1) break;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      i = nextOpen + 1;
    } else {
      depth--;
      if (depth === 0) break;
      i = nextClose + 1;
    }
  }
  const endIdx = html.indexOf('</section>', i) + '</section>'.length;
  return html.substring(startIdx, endIdx);
}

function extractSectionHeader(sectionHtml) {
  const labelMatch = sectionHtml.match(/<span class="section-label">([^<]+)<\/span>/);
  const h2Match = sectionHtml.match(/<h2[^>]*>([^<]+)<\/h2>/);
  const descMatch = sectionHtml.match(/<h2[^>]*>[^<]+<\/h2>\s*<p>([\s\S]*?)<\/p>/);
  return {
    sectionLabel: labelMatch ? labelMatch[1].trim() : '',
    h2: h2Match ? h2Match[1].trim() : '',
    description: descMatch ? descMatch[1].trim() : '',
  };
}

/**
 * Extract info-card h3+p pairs from a section HTML.
 * Returns array of { h3, p }.
 */
function extractInfoCards(sectionHtml) {
  const cards = [];
  // Match info-cards with any attributes
  const cardPat = '<div class="info-card">';
  let searchIdx = 0;

  while (true) {
    const startIdx = sectionHtml.indexOf(cardPat, searchIdx);
    if (startIdx === -1) break;
    const afterStart = startIdx + cardPat.length;

    const innerHtml = extractDivInnerHtml(sectionHtml, afterStart);
    if (!innerHtml) { searchIdx = afterStart; continue; }

    const h3Match = innerHtml.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
    const h3 = h3Match ? h3Match[1].trim() : '';
    const pMatch = innerHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    const p = pMatch ? pMatch[1].trim() : '';

    cards.push({ h3, p });
    // Advance past the entire card
    const endIdx = sectionHtml.indexOf('</div>', afterStart + innerHtml.length);
    searchIdx = endIdx !== -1 ? endIdx + 6 : afterStart + innerHtml.length + 6;
  }
  return cards;
}

/**
 * Extract simple tip sections (sectionLabel, h2, description, cards: [{h3, p}]).
 */
function extractSimpleTip(html, sectionId, lang, ariaKeyword) {
  const sec = extractSection(html, sectionId, ariaKeyword);
  if (!sec) {
    warn(lang, `Section not found: ${sectionId}`);
    return {};
  }
  const header = extractSectionHeader(sec);
  const cards = extractInfoCards(sec);
  return { ...header, cards };
}

/**
 * Extract complex tip sections (sectionLabel, h2, description, content).
 * Finds a div matching divPattern and extracts its innerHTML.
 */
function extractComplexTip(html, sectionId, divPattern, lang, ariaKeyword) {
  const sec = extractSection(html, sectionId, ariaKeyword);
  if (!sec) {
    warn(lang, `Section not found: ${sectionId}`);
    return {};
  }
  const header = extractSectionHeader(sec);

  // Find the div matching the pattern
  const idx = sec.indexOf(divPattern);
  if (idx === -1) {
    warn(lang, `Div pattern not found in section ${sectionId}: "${divPattern.substring(0, 60)}"`);
    return { ...header, content: '' };
  }
  const afterTag = sec.indexOf('>', idx) + 1;
  const content = extractDivInnerHtml(sec, afterTag);

  return { ...header, content };
}

// ─── Individual tip extractors ───────────────────────────────────────────────

function extractTip1(html, lang) {
  return extractSimpleTip(html, 'before-you-go', lang, 'Sebelum Pergi');
}

function extractTip2(html, lang) {
  return extractSimpleTip(html, 'what-to-bring', lang, 'Dibawa');
}

function extractTip3(html, lang) {
  return extractSimpleTip(html, 'what-not-to-bring', lang, 'Tidak Perlu Dibawa');
}

function extractTip4(html, lang) {
  const sec = extractSection(html, 'dress-code', 'Kod Pakaian');
  if (!sec) { warn(lang, 'Section not found: dress-code'); return {}; }
  const header = extractSectionHeader(sec);

  // Find <div class="fade-in" style="max-width: 800px; margin: 0 auto;">
  const divPat = '<div class="fade-in" style="max-width: 800px; margin: 0 auto;">';
  const idx = sec.indexOf(divPat);
  if (idx === -1) {
    warn(lang, 'Could not find fade-in div in dress-code');
    return { ...header, content: '' };
  }
  const afterTag = idx + divPat.length;
  const content = extractDivInnerHtml(sec, afterTag);
  return { ...header, content };
}

function extractTip5(html, lang) {
  return extractSimpleTip(html, 'best-time', lang, 'Masa Terbaik');
}

function extractTip6(html, lang) {
  const sec = extractSection(html, 'money-saving', 'Jimat Wang');
  if (!sec) { warn(lang, 'Section not found: money-saving'); return {}; }
  const header = extractSectionHeader(sec);
  const cards = extractInfoCards(sec);

  // ticketsLink: text of <a href="/tickets.html" ...>
  const ticketsLinkMatch = sec.match(/href="[^"]*\/tickets\.html"[^>]*>([\s\S]*?)<\/a>/);
  const ticketsLink = ticketsLinkMatch ? ticketsLinkMatch[1].trim() : '';

  return { ...header, cards, ticketsLink };
}

function extractTip7(html, lang) {
  const sec = extractSection(html, 'food-guide', 'Panduan Makanan');
  if (!sec) { warn(lang, 'Section not found: food-guide'); return {}; }
  const header = extractSectionHeader(sec);
  const cards = extractInfoCards(sec);

  // reminder: the yellow warning info-card's <p> innerHTML
  // It has style with background: #fff3cd or border-color: #ffc107
  const reminderCardMatch = sec.match(/<div class="info-card[^"]*"[^>]*style="[^"]*(?:fff3cd|ffc107)[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  let reminder = '';
  if (reminderCardMatch) {
    const pMatch = reminderCardMatch[1].match(/<p[^>]*>([\s\S]*?)<\/p>/);
    reminder = pMatch ? pMatch[1].trim() : '';
  }
  if (!reminder) {
    // Fallback: find fade-in info-card after the grid
    const altMatch = sec.match(/class="info-card fade-in"[^>]*style="[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    if (altMatch) {
      const pMatch = altMatch[1].match(/<p[^>]*>([\s\S]*?)<\/p>/);
      reminder = pMatch ? pMatch[1].trim() : '';
    }
  }

  return { ...header, cards, reminder };
}

function extractTip8(html, lang) {
  const sec = extractSection(html, 'ride-order', 'Turutan Wahana');
  if (!sec) { warn(lang, 'Section not found: ride-order'); return {}; }
  const header = extractSectionHeader(sec);

  const divPat = '<div class="fade-in" style="max-width: 800px; margin: 0 auto;">';
  const idx = sec.indexOf(divPat);
  if (idx === -1) {
    warn(lang, 'Could not find fade-in div in ride-order');
    return { ...header, content: '' };
  }
  const afterTag = idx + divPat.length;
  const content = extractDivInnerHtml(sec, afterTag);
  return { ...header, content };
}

function extractTip9(html, lang) {
  const sec = extractSection(html, 'families-kids', 'Keluarga');
  if (!sec) { warn(lang, 'Section not found: families-kids'); return {}; }
  const header = extractSectionHeader(sec);
  const cards = extractInfoCards(sec);

  // blogLink: text of .btn-outline link
  const blogLinkMatch = sec.match(/class="btn btn-outline[^"]*"[^>]*>([\s\S]*?)<\/a>/);
  const blogLink = blogLinkMatch ? blogLinkMatch[1].trim() : '';

  return { ...header, cards, blogLink };
}

function extractTip10(html, lang) {
  return extractSimpleTip(html, 'rainy-day', lang, 'Hari Hujan');
}

function extractTip11(html, lang) {
  const sec = extractSection(html, 'photo-tips', 'Tips Foto');
  if (!sec) { warn(lang, 'Section not found: photo-tips'); return {}; }
  const header = extractSectionHeader(sec);

  // The info-grid div
  const gridPat = '<div class="info-grid fade-in"';
  const gridIdx = sec.indexOf(gridPat);
  let content = '';
  if (gridIdx === -1) {
    warn(lang, 'Could not find info-grid in photo-tips');
  } else {
    const afterTag = sec.indexOf('>', gridIdx) + 1;
    content = extractDivInnerHtml(sec, afterTag);
  }

  // proTip: the standalone info-card <p> innerHTML at bottom
  // It appears after the grid, has class "info-card fade-in" with style
  const proTipMatch = sec.match(/class="info-card fade-in"[^>]*style="[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  let proTip = '';
  if (proTipMatch) {
    const pMatch = proTipMatch[1].match(/<p[^>]*>([\s\S]*?)<\/p>/);
    proTip = pMatch ? pMatch[1].trim() : '';
  }

  return { ...header, content, proTip };
}

function extractTip12(html, lang) {
  const sec = extractSection(html, 'cabana', 'Kabana');
  if (!sec) { warn(lang, 'Section not found: cabana'); return {}; }
  const header = extractSectionHeader(sec);

  // The grid div: style includes "display: grid"
  const divPat = '<div class="fade-in" style="max-width: 800px; margin: 0 auto; display: grid;';
  let idx = sec.indexOf(divPat);
  // Fallback: look for any fade-in div with display: grid
  if (idx === -1) {
    const re = /<div class="fade-in" style="[^"]*display:\s*grid[^"]*">/;
    const m = re.exec(sec);
    if (m) idx = m.index;
  }
  let content = '';
  if (idx === -1) {
    warn(lang, 'Could not find grid div in cabana');
  } else {
    const afterTag = sec.indexOf('>', idx) + 1;
    content = extractDivInnerHtml(sec, afterTag);
  }

  // verdict: the standalone info-card fade-in <p> innerHTML
  const verdictMatch = sec.match(/class="info-card fade-in"[^>]*style="[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  let verdict = '';
  if (verdictMatch) {
    const pMatch = verdictMatch[1].match(/<p[^>]*>([\s\S]*?)<\/p>/);
    verdict = pMatch ? pMatch[1].trim() : '';
  }

  return { ...header, content, verdict };
}

function extractTip13(html, lang) {
  return extractSimpleTip(html, 'safety', lang, 'Keselamatan');
}

function extractTip14(html, lang) {
  return extractSimpleTip(html, 'after-the-park', lang, 'Selepas Taman');
}

function extractTip15(html, lang) {
  const sec = extractSection(html, 'quick-tips', 'Tips Pantas');
  if (!sec) { warn(lang, 'Section not found: quick-tips'); return {}; }
  const header = extractSectionHeader(sec);

  const divPat = '<div class="fade-in" style="max-width: 800px; margin: 0 auto;">';
  const idx = sec.indexOf(divPat);
  if (idx === -1) {
    warn(lang, 'Could not find fade-in div in quick-tips');
    return { ...header, content: '' };
  }
  const afterTag = idx + divPat.length;
  const content = extractDivInnerHtml(sec, afterTag);
  return { ...header, content };
}

function extractInternalLinks(html, lang) {
  // The internal links section always contains 4 cards linking to attractions/tickets/getting-there/faq
  // It can have various aria-labels across languages. Find it by looking for the section
  // that contains a link to attractions.html (a reliable marker).
  // Strategy: find all sections without an id (the internal links section has no id),
  // then pick the one containing an attractions.html link that has section-header.
  let secMatch = html.match(/<section[^>]*aria-label="[^"]*(?:Related|Halaman Berkaitan)[^"]*"[^>]*>([\s\S]*?)<\/section>/i);
  if (!secMatch) {
    // More generic: find a section-gray section with no id that has "section-label" and links to attractions
    const re = /<section class="section section-gray"(?![^>]*id=)[^>]*>([\s\S]*?)<\/section>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      if (m[1].includes('attractions') && m[1].includes('section-label')) {
        secMatch = m;
        break;
      }
    }
  }
  if (!secMatch) {
    // Last resort: any section (not section-gray) with no id that has attractions link and section-label
    const re = /<section class="section(?:\s+section-gray)?"(?![^>]*id=)[^>]*>([\s\S]*?)<\/section>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      if (m[1].includes('attractions') && m[1].includes('section-label')) {
        secMatch = m;
        break;
      }
    }
  }
  if (!secMatch) {
    warn(lang, 'Internal links section not found');
    return {};
  }
  const sec = secMatch[1];

  const labelMatch = sec.match(/<span class="section-label">([^<]+)<\/span>/);
  const sectionLabel = labelMatch ? labelMatch[1].trim() : '';

  const h2Match = sec.match(/<h2[^>]*>([^<]+)<\/h2>/);
  const heading = h2Match ? h2Match[1].trim() : '';

  // Cards: h3 with link text inside <a>, p text
  const cards = [];
  const cardPat = '<div class="info-card">';
  let searchIdx = 0;
  while (true) {
    const startIdx = sec.indexOf(cardPat, searchIdx);
    if (startIdx === -1) break;
    const afterStart = startIdx + cardPat.length;
    const innerHtml = extractDivInnerHtml(sec, afterStart);
    if (!innerHtml) { searchIdx = afterStart; continue; }

    const h3Match = innerHtml.match(/<h3[^>]*><a[^>]*>([\s\S]*?)<\/a><\/h3>/);
    const h3 = h3Match ? h3Match[1].trim() : '';
    const pMatch = innerHtml.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    const p = pMatch ? pMatch[1].trim() : '';

    cards.push({ h3, p });
    const endIdx = sec.indexOf('</div>', afterStart + innerHtml.length);
    searchIdx = endIdx !== -1 ? endIdx + 6 : afterStart + innerHtml.length + 6;
  }

  return { sectionLabel, heading, cards };
}

function extractCta(html, lang) {
  const ctaMatch = html.match(/<div class="cta-banner[^"]*"[^>]*>([\s\S]*?)<\/div>/);
  if (!ctaMatch) {
    warn(lang, 'CTA banner not found');
    return {};
  }
  const ctaHtml = ctaMatch[1];

  const h2Match = ctaHtml.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
  const heading = h2Match ? h2Match[1].trim() : '';

  // First <p> (main text)
  const pMatches = [...ctaHtml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)];
  const text = pMatches[0] ? pMatches[0][1].trim() : '';

  const btnMatch = ctaHtml.match(/class="btn btn-white[^"]*"[^>]*>([\s\S]*?)<\/a>/);
  const button = btnMatch ? btnMatch[1].trim() : '';

  // subtext: last <p> or <p class="text-sm"> or <p style="...">
  let subtext = '';
  if (pMatches.length > 1) {
    subtext = pMatches[pMatches.length - 1][1].trim();
  }

  return { heading, text, button, subtext };
}

function extractAll(html, lang) {
  const title = extractTitle(html);
  const metaDescription = extractMeta(html, 'description');
  const metaKeywords = extractMeta(html, 'keywords');
  const ogTitle = extractMeta(html, 'og:title');
  const ogDescription = extractMeta(html, 'og:description');
  const twitterTitle = extractMeta(html, 'twitter:title');
  const twitterDescription = extractMeta(html, 'twitter:description');

  if (!title) warn(lang, 'title not found');

  const breadcrumbCurrent = extractBreadcrumbCurrent(html);
  if (!breadcrumbCurrent) warn(lang, 'breadcrumbCurrent not found');

  const hero = extractHeroBlock(html);
  if (!hero.h1) warn(lang, 'h1 not found');

  const tldr = extractTldr(html);
  if (!tldr.length) warn(lang, 'tldr items not found');

  const toc = extractToc(html);
  if (!toc.items.length) warn(lang, 'toc items not found');

  const tip1 = extractTip1(html, lang);
  const tip2 = extractTip2(html, lang);
  const tip3 = extractTip3(html, lang);
  const tip4 = extractTip4(html, lang);
  const tip5 = extractTip5(html, lang);
  const tip6 = extractTip6(html, lang);
  const tip7 = extractTip7(html, lang);
  const tip8 = extractTip8(html, lang);
  const tip9 = extractTip9(html, lang);
  const tip10 = extractTip10(html, lang);
  const tip11 = extractTip11(html, lang);
  const tip12 = extractTip12(html, lang);
  const tip13 = extractTip13(html, lang);
  const tip14 = extractTip14(html, lang);
  const tip15 = extractTip15(html, lang);

  const internalLinks = extractInternalLinks(html, lang);
  const cta = extractCta(html, lang);

  return {
    title,
    metaDescription,
    metaKeywords,
    ogTitle,
    ogDescription,
    twitterTitle,
    twitterDescription,
    breadcrumbCurrent,
    h1: hero.h1,
    h1Span: hero.h1Span,
    heroSub: hero.heroSub,
    tldr,
    toc,
    tip1,
    tip2,
    tip3,
    tip4,
    tip5,
    tip6,
    tip7,
    tip8,
    tip9,
    tip10,
    tip11,
    tip12,
    tip13,
    tip14,
    tip15,
    internalLinks,
    cta,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

let errors = 0;
for (const lang of SITE.languages) {
  const filePath = getFilePath(lang.code);
  if (!fs.existsSync(filePath)) {
    console.warn(`  Warning: Missing file for ${lang.code}: ${filePath}`);
    continue;
  }

  const html = fs.readFileSync(filePath, 'utf8');
  const extracted = extractAll(html, lang.code);

  // Load existing i18n JSON
  const i18nPath = path.join(I18N_DIR, `${lang.code}.json`);
  let i18n = {};
  if (fs.existsSync(i18nPath)) {
    try {
      i18n = JSON.parse(fs.readFileSync(i18nPath, 'utf8'));
    } catch (e) {
      console.error(`  ERROR parsing ${i18nPath}:`, e.message);
      errors++;
      continue;
    }
  }

  // Merge under tips key
  i18n.tips = extracted;

  fs.writeFileSync(i18nPath, JSON.stringify(i18n, null, 2) + '\n');
  console.log(`  Extracted ${lang.code}: title="${extracted.title.substring(0, 60)}", toc.items=${extracted.toc.items.length}, tldr=${extracted.tldr.length}`);
}

if (errors === 0) {
  console.log('\nDone! tips key merged into all i18n files.');
} else {
  console.error(`\nDone with ${errors} error(s).`);
}
