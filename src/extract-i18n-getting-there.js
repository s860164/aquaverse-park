#!/usr/bin/env node

/**
 * One-time extraction script: pulls translatable strings from existing getting-there.html
 * files across all 12 languages and merges them into src/i18n/{lang}.json under "gettingThere" key.
 *
 * Run once: node src/extract-i18n-getting-there.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITE = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'site.json'), 'utf8'));

function getFilePath(langCode) {
  if (langCode === 'en') return path.join(ROOT, 'getting-there.html');
  return path.join(ROOT, langCode, 'getting-there.html');
}

function extractBetween(html, startPattern, endPattern, fromIndex = 0) {
  const startIdx = html.indexOf(startPattern, fromIndex);
  if (startIdx === -1) return '';
  const afterStart = startIdx + startPattern.length;
  const endIdx = html.indexOf(endPattern, afterStart);
  if (endIdx === -1) return '';
  return html.substring(afterStart, endIdx).trim();
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

function extractTitle(html) {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  return m ? m[1].trim() : '';
}

// Extract all <li> inner HTML from a <ul> block
function extractListItems(ulHtml) {
  const items = [];
  const liRe = /<li>([\s\S]*?)<\/li>/g;
  let m;
  while ((m = liRe.exec(ulHtml)) !== null) {
    items.push(m[1].trim());
  }
  return items;
}

function extractHero(html) {
  const heroSection = extractBetween(html, '<section class="hero" role="banner">', '</section>');
  if (!heroSection) return {};

  // badge text (strip the aria-hidden span icon)
  const badgeMatch = heroSection.match(/<div class="hero-badge">([\s\S]*?)<\/div>/);
  let badge = '';
  if (badgeMatch) {
    badge = badgeMatch[1]
      .replace(/<span aria-hidden="true">[^<]*<\/span>/, '')
      .trim();
  }

  // h1
  const h1Match = heroSection.match(/<h1>([\s\S]*?)<\/h1>/);
  let h1 = '';
  let h1Sub = '';
  if (h1Match) {
    const h1Content = h1Match[1];
    const spanMatch = h1Content.match(/<span>([\s\S]*?)<\/span>/);
    h1Sub = spanMatch ? spanMatch[1].trim() : '';
    h1 = h1Content.replace(/<span>[\s\S]*?<\/span>/, '').trim();
  }

  // hero-sub
  const subMatch = heroSection.match(/<p class="hero-sub">([\s\S]*?)<\/p>/);
  const sub = subMatch ? subMatch[1].trim() : '';

  // CTA buttons
  const ctaMatches = [...heroSection.matchAll(/class="btn[^"]*"[^>]*>\s*([\s\S]*?)\s*<\/a>/g)];
  const cta1 = ctaMatches[0] ? ctaMatches[0][1].trim() : '';
  const cta2 = ctaMatches[1] ? ctaMatches[1][1].trim() : '';

  // hero stats
  const stats = [];
  const statRe = /<div class="hero-stat">\s*<span class="hero-stat-number">([\s\S]*?)<\/span>\s*<span class="hero-stat-label">([\s\S]*?)<\/span>/g;
  let sm;
  while ((sm = statRe.exec(heroSection)) !== null) {
    stats.push({ number: sm[1].trim(), label: sm[2].trim() });
  }

  return { badge, h1, h1Sub, sub, cta1, cta2, stats };
}

function extractBreadcrumb(html) {
  // First try: <nav aria-label="breadcrumb"> with non-linked current page span
  const bcMatch = html.match(/<nav[^>]*aria-label="[Bb]readcrumb[^"]*"[^>]*>([\s\S]*?)<\/nav>/);
  if (bcMatch) {
    const bcHtml = bcMatch[1];
    const ariaMatch = bcHtml.match(/aria-current="page"[^>]*>([^<]+)<\/a>|<span[^>]*>([^<]+)<\/span>\s*<\/li>\s*<\/ol>/);
    if (ariaMatch) return (ariaMatch[1] || ariaMatch[2] || '').trim();
    const spans = [...bcHtml.matchAll(/<span[^>]*>([^<]+)<\/span>/g)];
    if (spans.length > 0) return spans[spans.length - 1][1].trim();
  }
  // Fallback: find the nav link with aria-current="page" (active nav item = current page label)
  const activeMatch = html.match(/aria-current="page">([^<]+)<\/a>/);
  if (activeMatch) return activeMatch[1].trim();
  return '';
}

function extractTldr(html) {
  const tldrBlock = extractBetween(html, '<div class="tldr-box">', '</div>');
  if (!tldrBlock) return [];

  const liRe = /<li>([\s\S]*?)<\/li>/g;
  const items = [];
  let m;
  while ((m = liRe.exec(tldrBlock)) !== null) {
    const liHtml = m[1].trim();
    const strongMatch = liHtml.match(/^<strong>([\s\S]*?)<\/strong>([\s\S]*)$/);
    if (strongMatch) {
      items.push({
        bold: strongMatch[1].trim(),
        text: strongMatch[2].trim().replace(/^:\s*/, ''),
      });
    } else {
      items.push({ bold: '', text: liHtml });
    }
  }
  return items;
}

function extractSection(html, sectionId) {
  const sectionStart = `<section class="section" id="${sectionId}"`;
  const altStart = `<section class="section section-gray" id="${sectionId}"`;
  let startIdx = html.indexOf(sectionStart);
  if (startIdx === -1) startIdx = html.indexOf(altStart);
  if (startIdx === -1) return '';

  // Find closing </section>
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
  const h2Match = sectionHtml.match(/<h2>([^<]+)<\/h2>/);
  const pMatch = sectionHtml.match(/<h2>[^<]+<\/h2>\s*<p>([\s\S]*?)<\/p>/);
  return {
    sectionLabel: labelMatch ? labelMatch[1].trim() : '',
    heading: h2Match ? h2Match[1].trim() : '',
    description: pMatch ? pMatch[1].trim() : '',
  };
}

function extractLocation(html) {
  const sec = extractSection(html, 'location');
  if (!sec) return {};

  const header = extractSectionHeader(sec);

  // GBP category
  const categoryMatch = sec.match(/<div class="gbp-category">([^<]+)<\/div>/);
  const category = categoryMatch ? categoryMatch[1].trim() : '';

  // GBP details: the div after each icon span
  const detailRe = /<div class="gbp-detail">\s*<span class="gbp-detail-icon"[^>]*>[^<]*<\/span>\s*<div>([\s\S]*?)<\/div>\s*<\/div>/g;
  const details = [];
  let dm;
  while ((dm = detailRe.exec(sec)) !== null) {
    details.push(dm[1].trim());
  }

  // Map button text
  const mapBtnMatch = sec.match(/class="btn btn-primary btn-block"[^>]*>([^<]*)<\/a>/);
  const mapBtn = mapBtnMatch ? mapBtnMatch[1].trim() : '';

  // Map caption
  const captionMatch = sec.match(/<p style="margin-top: 0\.75rem[^>]*">([\s\S]*?)<\/p>/);
  const mapCaption = captionMatch ? captionMatch[1].trim() : '';

  return {
    ...header,
    gbp: { category, details, mapBtn },
    mapCaption,
  };
}

function extractFromBangkok(html) {
  const sec = extractSection(html, 'from-bangkok');
  if (!sec) return {};

  const header = extractSectionHeader(sec);

  // Cards
  const cards = [];
  const cardRe = /<div class="info-card"[^>]*id="[^"]*">([\s\S]*?)<\/div>\s*(?=<div class="info-card"|<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<\/section>)/g;

  // More reliable: find each info-card with id
  const cardIds = ['by-car', 'by-bus', 'by-van', 'by-taxi'];
  for (const id of cardIds) {
    const startPat = `<div class="info-card" id="${id}">`;
    const startIdx = sec.indexOf(startPat);
    if (startIdx === -1) continue;
    const afterStart = startIdx + startPat.length;

    // find matching closing div
    let depth = 1;
    let i = afterStart;
    while (i < sec.length && depth > 0) {
      const nextOpen = sec.indexOf('<div', i);
      const nextClose = sec.indexOf('</div>', i);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        i = nextOpen + 8;
      } else {
        depth--;
        if (depth === 0) {
          const cardContent = sec.substring(afterStart, nextClose).trim();
          // Extract h3
          const h3Match = cardContent.match(/<h3>([\s\S]*?)<\/h3>/);
          const h3 = h3Match ? h3Match[1].trim() : '';
          // Content = everything after </h3>
          const h3End = cardContent.indexOf('</h3>') + '</h3>'.length;
          const content = cardContent.substring(h3End).trim()
            // Remove the info-icon div
            .replace(/<div class="info-icon"[^>]*>[^<]*<\/div>/, '').trim();
          cards.push({ h3, content });
          break;
        }
        i = nextClose + 6;
      }
    }
  }

  return { ...header, cards };
}

function extractFromAirports(html) {
  const sec = extractSection(html, 'from-airports');
  if (!sec) return {};

  const header = extractSectionHeader(sec);
  const cards = [];
  const cardIds = ['from-suvarnabhumi', 'from-utapao'];

  for (const id of cardIds) {
    const startPat = `<div class="info-card fade-in" id="${id}">`;
    const startIdx = sec.indexOf(startPat);
    if (startIdx === -1) continue;
    const afterStart = startIdx + startPat.length;

    let depth = 1;
    let i = afterStart;
    while (i < sec.length && depth > 0) {
      const nextOpen = sec.indexOf('<div', i);
      const nextClose = sec.indexOf('</div>', i);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        i = nextOpen + 8;
      } else {
        depth--;
        if (depth === 0) {
          const cardContent = sec.substring(afterStart, nextClose).trim();
          const h3Match = cardContent.match(/<h3>([\s\S]*?)<\/h3>/);
          const h3 = h3Match ? h3Match[1].trim() : '';
          const h3End = cardContent.indexOf('</h3>') + '</h3>'.length;
          const content = cardContent.substring(h3End).trim()
            .replace(/<div class="info-icon"[^>]*>[^<]*<\/div>/, '').trim();
          cards.push({ h3, content });
          break;
        }
        i = nextClose + 6;
      }
    }
  }

  return { ...header, cards };
}

function extractFromPattaya(html) {
  const sec = extractSection(html, 'from-pattaya');
  if (!sec) return {};

  const header = extractSectionHeader(sec);

  // Extract 3 info-cards (no ids)
  const cards = [];
  const cardStartPat = '<div class="info-card">';
  let searchIdx = 0;

  while (true) {
    const startIdx = sec.indexOf(cardStartPat, searchIdx);
    if (startIdx === -1) break;
    const afterStart = startIdx + cardStartPat.length;

    let depth = 1;
    let i = afterStart;
    let found = false;
    while (i < sec.length && depth > 0) {
      const nextOpen = sec.indexOf('<div', i);
      const nextClose = sec.indexOf('</div>', i);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        i = nextOpen + 8;
      } else {
        depth--;
        if (depth === 0) {
          const cardContent = sec.substring(afterStart, nextClose).trim();
          const h3Match = cardContent.match(/<h3>([\s\S]*?)<\/h3>/);
          const h3 = h3Match ? h3Match[1].trim() : '';
          // Get all <p> tags
          const pMatches = [...cardContent.matchAll(/<p>([\s\S]*?)<\/p>/g)];
          const price = pMatches[0] ? pMatches[0][1].trim() : '';
          const description = pMatches[1] ? pMatches[1][1].trim() : '';
          cards.push({ h3, price, description });
          searchIdx = nextClose + 6;
          found = true;
          break;
        }
        i = nextClose + 6;
      }
    }
    if (!found) break;
  }

  return { ...header, cards };
}

function extractTransportTips(html) {
  const sec = extractSection(html, 'transport-tips');
  if (!sec) return {};

  const header = extractSectionHeader(sec);

  // Recommended heading (h3 in info-card)
  const h3Match = sec.match(/<h3[^>]*>([\s\S]*?)<\/h3>/);
  const recommendedHeading = h3Match ? h3Match[1].trim() : '';

  // Recommended list: full <ul> element
  const ulMatch = sec.match(/<ul[^>]*>([\s\S]*?)<\/ul>/);
  const recommendedList = ulMatch ? `<ul style="font-size: 0.9375rem; line-height: 1.8;">${ulMatch[1]}</ul>` : '';

  // Booking button text
  const bookingBtnMatch = sec.match(/data-booking>\s*([^<]*?)\s*<\/a>/);
  const bookingBtn = bookingBtnMatch ? bookingBtnMatch[1].trim() : '';

  // Price highlight card
  const gradientMatch = sec.match(/background: linear-gradient[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/);

  // Price (big div)
  const priceMatch = sec.match(/<div style="font-size: 2rem[^>]*>([^<]+)<\/div>/);
  const price = priceMatch ? priceMatch[1].trim() : '';

  // Label (opacity div)
  const labelMatch = sec.match(/<div style="font-size: 0\.875rem; opacity[^>]*>([^<]+)<\/div>/);
  const label = labelMatch ? labelMatch[1].trim() : '';

  // Checkmarks: li items in the gradient card ul
  const gradientUlMatch = sec.match(/list-style: none[^>]*>([\s\S]*?)<\/ul>/);
  const checkmarks = [];
  if (gradientUlMatch) {
    const liRe = /<li>([^<]*)<\/li>/g;
    let m;
    while ((m = liRe.exec(gradientUlMatch[1])) !== null) {
      checkmarks.push(m[1].trim());
    }
  }

  return {
    ...header,
    recommendedHeading,
    recommendedList,
    bookingBtn,
    priceHighlight: { price, label, checkmarks },
  };
}

function extractParking(html) {
  const sec = extractSection(html, 'parking');
  if (!sec) return {};

  const header = extractSectionHeader(sec);

  const cards = [];
  const cardStartPat = '<div class="info-card">';
  let searchIdx = 0;

  while (true) {
    const startIdx = sec.indexOf(cardStartPat, searchIdx);
    if (startIdx === -1) break;
    const afterStart = startIdx + cardStartPat.length;

    let depth = 1;
    let i = afterStart;
    let found = false;
    while (i < sec.length && depth > 0) {
      const nextOpen = sec.indexOf('<div', i);
      const nextClose = sec.indexOf('</div>', i);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        i = nextOpen + 8;
      } else {
        depth--;
        if (depth === 0) {
          const cardContent = sec.substring(afterStart, nextClose).trim();
          const h3Match = cardContent.match(/<h3>([\s\S]*?)<\/h3>/);
          const h3 = h3Match ? h3Match[1].trim() : '';
          const pMatch = cardContent.match(/<p>([\s\S]*?)<\/p>/);
          const text = pMatch ? pMatch[1].trim() : '';
          cards.push({ h3, text });
          searchIdx = nextClose + 6;
          found = true;
          break;
        }
        i = nextClose + 6;
      }
    }
    if (!found) break;
  }

  return { ...header, cards };
}

function extractComparison(html) {
  const sec = extractSection(html, 'compare');
  if (!sec) return {};

  const header = extractSectionHeader(sec);

  // Headers
  const headers = [];
  const thRe = /<th[^>]*>([^<]+)<\/th>/g;
  let m;
  while ((m = thRe.exec(sec)) !== null) {
    headers.push(m[1].trim());
  }

  // Rows
  const rows = [];
  const rowRe = /<tr[^>]*style="[^"]*border-bottom[^"]*"[^>]*>([\s\S]*?)<\/tr>|<tr style="background[^"]*">([\s\S]*?)<\/tr>/g;
  const allRowRe = /<tbody>([\s\S]*?)<\/tbody>/;
  const tbodyMatch = sec.match(allRowRe);
  if (tbodyMatch) {
    const tbody = tbodyMatch[1];
    const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    let tr;
    while ((tr = trRe.exec(tbody)) !== null) {
      const tds = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)];
      if (tds.length >= 5) {
        rows.push({
          transport: tds[0][1].trim(),
          time: tds[1][1].trim(),
          cost: tds[2][1].trim(),
          convenience: tds[3][1].trim(),
          bestFor: tds[4][1].trim(),
        });
      }
    }
  }

  return { ...header, headers, rows };
}

function extractTips(html) {
  const sec = extractSection(html, 'tips');
  if (!sec) return {};

  const header = extractSectionHeader(sec);

  const cards = [];
  const cardStartPat = '<div class="info-card">';
  let searchIdx = 0;

  while (true) {
    const startIdx = sec.indexOf(cardStartPat, searchIdx);
    if (startIdx === -1) break;
    const afterStart = startIdx + cardStartPat.length;

    let depth = 1;
    let i = afterStart;
    let found = false;
    while (i < sec.length && depth > 0) {
      const nextOpen = sec.indexOf('<div', i);
      const nextClose = sec.indexOf('</div>', i);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        i = nextOpen + 8;
      } else {
        depth--;
        if (depth === 0) {
          const cardContent = sec.substring(afterStart, nextClose).trim();
          const h3Match = cardContent.match(/<h3>([\s\S]*?)<\/h3>/);
          const h3 = h3Match ? h3Match[1].trim() : '';
          const pMatch = cardContent.match(/<p>([\s\S]*?)<\/p>/);
          const text = pMatch ? pMatch[1].trim() : '';
          cards.push({ h3, text });
          searchIdx = nextClose + 6;
          found = true;
          break;
        }
        i = nextClose + 6;
      }
    }
    if (!found) break;
  }

  // ctaText and cta button
  const textCenterMatch = sec.match(/<div class="text-center"[^>]*>([\s\S]*?)<\/div>/);
  let ctaText = '';
  let cta = '';
  if (textCenterMatch) {
    const block = textCenterMatch[1];
    const pMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    ctaText = pMatch ? pMatch[1].trim() : '';
    const aMatch = block.match(/class="btn[^"]*"[^>]*>([\s\S]*?)<\/a>/);
    cta = aMatch ? aMatch[1].trim() : '';
  }

  return { ...header, cards, ctaText, cta };
}

function extractCta(html) {
  const sec = extractSection(html, 'book');
  if (!sec) return {};

  const h2Match = sec.match(/<h2[^>]*>([^<]+)<\/h2>/);
  const heading = h2Match ? h2Match[1].trim() : '';

  const pMatch = sec.match(/<p[^>]*style="font-size: 1\.125rem[^>]*>([\s\S]*?)<\/p>/);
  const text = pMatch ? pMatch[1].trim() : '';

  // First button (data-booking)
  const btn1Match = sec.match(/data-booking>\s*([\s\S]*?)\s*<\/a>/);
  const btn1 = btn1Match ? btn1Match[1].trim() : '';

  // Second button (blog link)
  const btn2Match = sec.match(/blog\/how-to-get-to-aquaverse-from-bangkok[^"]*"[^>]*>([\s\S]*?)<\/a>/);
  const btn2 = btn2Match ? btn2Match[1].trim() : '';

  // Subtext
  const subtextMatch = sec.match(/<p style="margin-top: 1\.5rem[^>]*>([\s\S]*?)<\/p>/);
  const subtext = subtextMatch ? subtextMatch[1].trim() : '';

  return { heading, text, btn1, btn2, subtext };
}

function extractSchema(html) {
  // Extract FAQPage JSON-LD
  const faqItems = [];
  const faqMatch = html.match(/"@type": "FAQPage"[\s\S]*?"mainEntity": \[([\s\S]*?)\]\s*\}/);
  if (faqMatch) {
    const mainEntityStr = `[${faqMatch[1]}]`;
    try {
      // Parse the FAQ items
      const re = /"@type": "Question",\s*"name": "([^"]+)",\s*"acceptedAnswer": \{\s*"@type": "Answer",\s*"text": "([^"]+)"/g;
      let m;
      while ((m = re.exec(mainEntityStr)) !== null) {
        faqItems.push({ question: m[1], answer: m[2] });
      }
    } catch (e) {
      // ignore parse errors
    }
  }

  // Extract HowTo JSON-LD
  const howToMatch = html.match(/"@type": "HowTo"[\s\S]*?"name": "([^"]+)",\s*"description": "([^"]+)"[\s\S]*?"step": \[([\s\S]*?)\]\s*\}/);
  let howTo = null;
  if (howToMatch) {
    const name = howToMatch[1];
    const description = howToMatch[2];
    const stepsStr = howToMatch[3];
    const steps = [];
    const stepRe = /"name": "([^"]+)",\s*"text": "([^"]+)"/g;
    let sm;
    while ((sm = stepRe.exec(stepsStr)) !== null) {
      steps.push({ name: sm[1], text: sm[2] });
    }
    howTo = { name, description, steps };
  }

  return { faqItems, howTo };
}

function extractAll(html) {
  const hero = extractHero(html);
  const breadcrumbCurrent = extractBreadcrumb(html);
  const tldr = extractTldr(html);
  const location = extractLocation(html);
  const fromBangkok = extractFromBangkok(html);
  const fromAirports = extractFromAirports(html);
  const fromPattaya = extractFromPattaya(html);
  const transportTips = extractTransportTips(html);
  const parking = extractParking(html);
  const comparison = extractComparison(html);
  const tips = extractTips(html);
  const cta = extractCta(html);
  const schema = extractSchema(html);

  return {
    title: extractTitle(html),
    metaDescription: extractMeta(html, 'description'),
    metaKeywords: extractMeta(html, 'keywords'),
    ogTitle: extractMeta(html, 'og:title'),
    ogDescription: extractMeta(html, 'og:description'),
    twitterTitle: extractMeta(html, 'twitter:title'),
    twitterDescription: extractMeta(html, 'twitter:description'),
    hero,
    breadcrumbCurrent,
    tldr,
    location,
    fromBangkok,
    fromAirports,
    fromPattaya,
    transportTips,
    parking,
    comparison,
    tips,
    cta,
    schema,
  };
}

// Main
let errors = 0;
for (const lang of SITE.languages) {
  const filePath = getFilePath(lang.code);
  if (!fs.existsSync(filePath)) {
    console.warn(`  Warning: Missing file for ${lang.code}: ${filePath}`);
    continue;
  }

  const html = fs.readFileSync(filePath, 'utf8');
  const extracted = extractAll(html);

  // Load existing i18n JSON
  const i18nPath = path.join(__dirname, 'i18n', `${lang.code}.json`);
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

  // Merge under gettingThere key
  i18n.gettingThere = extracted;

  fs.writeFileSync(i18nPath, JSON.stringify(i18n, null, 2) + '\n');
  console.log(`  Extracted ${lang.code}: hero="${extracted.hero.badge}", breadcrumb="${extracted.breadcrumbCurrent}"`);
}

if (errors === 0) {
  console.log('\nDone! gettingThere key merged into all i18n files.');
} else {
  console.error(`\nDone with ${errors} error(s).`);
}
