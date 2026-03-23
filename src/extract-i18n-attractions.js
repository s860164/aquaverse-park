#!/usr/bin/env node

/**
 * One-time extraction script: pulls translatable strings from existing
 * attractions.html files across all 12 languages and writes them to
 * src/i18n/{lang}.json under the "attractions" key.
 *
 * Run once: node src/extract-i18n-attractions.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITE = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'site.json'), 'utf8'));

const ZONE_IDS = [
  'hotel-transylvania', 'ghostbusters', 'zombieland', 'jumanji',
  'surfs-up', 'cloudy', 'bad-boys', 'emoji', 'wave-pool',
];
const EXTRA_IDS = ['onsen', 'cabanas', 'rfid', 'height-restrictions'];

function getAttrPath(langCode) {
  return langCode === 'en'
    ? path.join(ROOT, 'attractions.html')
    : path.join(ROOT, langCode, 'attractions.html');
}

function extractMeta(html, name) {
  const patterns = [
    new RegExp(`<meta\\s+name="${name}"\\s+content="([^"]*)"`, 'i'),
    new RegExp(`<meta\\s+property="${name}"\\s+content="([^"]*)"`, 'i'),
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

function extractBetween(html, start, end, fromIdx = 0) {
  const startIdx = html.indexOf(start, fromIdx);
  if (startIdx === -1) return '';
  const afterStart = startIdx + start.length;
  const endIdx = html.indexOf(end, afterStart);
  if (endIdx === -1) return '';
  return html.substring(afterStart, endIdx).trim();
}

// Extract breadcrumb current label
function extractBreadcrumbCurrent(html) {
  const m = html.match(/<li aria-current="page">([^<]+)<\/li>/);
  return m ? m[1].trim() : '';
}

// Extract page header h1 and description
function extractPageHeader(html) {
  const headerStart = html.indexOf('<section class="page-header"');
  if (headerStart === -1) return { h1: '', description: '' };
  const headerEnd = html.indexOf('</section>', headerStart);
  const headerHtml = html.substring(headerStart, headerEnd);

  const h1Match = headerHtml.match(/<h1>([\s\S]*?)<\/h1>/);
  const h1 = h1Match ? h1Match[1].trim() : '';

  const pMatch = headerHtml.match(/<\/h1>\s*<p>([\s\S]*?)<\/p>/);
  const description = pMatch ? pMatch[1].trim() : '';

  return { h1, description };
}

// Extract TL;DR items
function extractTldr(html) {
  const tldrStart = html.indexOf('<div class="tldr-box">');
  if (tldrStart === -1) return [];
  const tldrEnd = html.indexOf('</div>', tldrStart);
  const tldrHtml = html.substring(tldrStart, tldrEnd);

  const items = [];
  const liRegex = /<li><strong>([\s\S]*?)<\/strong>([\s\S]*?)<\/li>/g;
  let m;
  while ((m = liRegex.exec(tldrHtml)) !== null) {
    items.push({ bold: m[1].trim(), text: m[2].trim() });
  }
  return items;
}

// Extract zone nav section
function extractZoneNav(html) {
  const mainStart = html.indexOf('<main id="main-content">');
  if (mainStart === -1) return { sectionLabel: '', heading: '', description: '', zones: [] };

  // First section-sm is TL;DR, second is zone quick nav
  const firstSm = html.indexOf('<section class="section-sm"', mainStart);
  const secondSm = html.indexOf('<section class="section-sm"', firstSm + 1);
  if (secondSm === -1) return { sectionLabel: '', heading: '', description: '', zones: [] };

  const nextSection = html.indexOf('<section', secondSm + 10);
  const navHtml = nextSection !== -1
    ? html.substring(secondSm, nextSection)
    : html.substring(secondSm, html.indexOf('</main>'));

  const sectionLabelMatch = navHtml.match(/<span class="section-label">([^<]+)<\/span>/);
  const headingMatch = navHtml.match(/<h2>([^<]+)<\/h2>/);
  const descMatch = navHtml.match(/<h2>[^<]+<\/h2>\s*<p>([^<]+)<\/p>/);

  const zones = [];
  // Extract each anchor zone-card by zone id in order
  for (const id of ZONE_IDS) {
    const anchorPat = new RegExp(`href="#${id}"[^>]*>([\\s\\S]*?)</a>`);
    const cardMatch = navHtml.match(anchorPat);
    if (!cardMatch) {
      zones.push({ tag: '', name: '', subtitle: '' });
      continue;
    }
    const cardHtml = cardMatch[1];
    const tagMatch = cardHtml.match(/<span class="zone-tag">([^<]+)<\/span>/);
    const nameMatch = cardHtml.match(/<h3>([\s\S]*?)<\/h3>/);
    const subtitleMatch = cardHtml.match(/<p>([\s\S]*?)<\/p>/);
    zones.push({
      tag:      tagMatch      ? tagMatch[1].trim()      : '',
      name:     nameMatch     ? nameMatch[1].trim()     : '',
      subtitle: subtitleMatch ? subtitleMatch[1].trim() : '',
    });
  }

  return {
    sectionLabel: sectionLabelMatch ? sectionLabelMatch[1].trim() : '',
    heading:      headingMatch      ? headingMatch[1].trim()      : '',
    description:  descMatch         ? descMatch[1].trim()         : '',
    zones,
  };
}

// Extract li items from a <ul> block (items: [{name, desc}])
function extractAttractionItems(ulHtml) {
  const items = [];
  const liRegex = /<li>([\s\S]*?)<\/li>/g;
  let m;
  while ((m = liRegex.exec(ulHtml)) !== null) {
    const liContent = m[1];
    const strongMatch = liContent.match(/<strong>([\s\S]*?)<\/strong>/);
    if (!strongMatch) continue;
    const name = strongMatch[1].trim();
    // Everything after </strong>, strip leading " &mdash; " or " — "
    const afterStrong = liContent.substring(liContent.indexOf('</strong>') + 9);
    const desc = afterStrong.replace(/^\s*(?:&mdash;|—)\s*/, '').trim();
    items.push({ name, desc });
  }
  return items;
}

// Extract zone detail sections
function extractZones(html) {
  const zones = [];
  for (const id of ZONE_IDS) {
    const idStr = `id="${id}"`;
    const idIdx = html.indexOf(idStr);
    if (idIdx === -1) {
      zones.push({});
      continue;
    }

    // Find enclosing <section tag
    const sectionStart = html.lastIndexOf('<section', idIdx);
    // Find zone-card-body within this section
    const bodyStart = html.indexOf('<div class="zone-card-body">', sectionStart);
    const articleEnd = html.indexOf('</article>', bodyStart);
    if (bodyStart === -1 || articleEnd === -1) {
      zones.push({});
      continue;
    }
    const bodyHtml = html.substring(bodyStart, articleEnd);

    // zone-tag (same as in zone nav but extract here too for convenience)
    const tagMatch = html.substring(sectionStart, bodyStart).match(/<span class="zone-tag">([^<]+)<\/span>/);
    const tag = tagMatch ? tagMatch[1].trim() : '';

    // h2
    const h2Match = bodyHtml.match(/<h2>([\s\S]*?)<\/h2>/);
    const h2 = h2Match ? h2Match[1].trim() : '';

    // zone-subtitle
    const subtitleMatch = bodyHtml.match(/<p class="zone-subtitle">([\s\S]*?)<\/p>/);
    const subtitle = subtitleMatch ? subtitleMatch[1].trim() : '';

    // intro paragraph (first <p> without a class after zone-subtitle)
    const afterSubtitleIdx = bodyHtml.indexOf('</p>', bodyHtml.indexOf('zone-subtitle')) + 4;
    const introMatch = bodyHtml.substring(afterSubtitleIdx).match(/^\s*\n\s*<p>([\s\S]*?)<\/p>/);
    const intro = introMatch ? introMatch[1].trim() : '';

    // h3 key attractions label
    const h3Match = bodyHtml.match(/<h3>([\s\S]*?)<\/h3>/);
    const keyAttractionsLabel = h3Match ? h3Match[1].trim() : '';

    // Attractions list
    const ulMatch = bodyHtml.match(/<ul>([\s\S]*?)<\/ul>/);
    const attractions = ulMatch ? extractAttractionItems(ulMatch[1]) : [];

    // Highlights
    const highlights = [];
    const hlDivMatch = bodyHtml.match(/<div class="zone-highlights">([\s\S]*?)<\/div>/);
    if (hlDivMatch) {
      const hlRegex = /<span class="zone-highlight">([^<]+)<\/span>/g;
      let hlM;
      while ((hlM = hlRegex.exec(hlDivMatch[1])) !== null) {
        highlights.push(hlM[1].trim());
      }
    }

    // Tip content (inner HTML of info-card div = the <p> element)
    const tipMatch = bodyHtml.match(/<div class="info-card"[^>]*>([\s\S]*?)<\/div>/);
    const tipContent = tipMatch ? tipMatch[1].trim() : '';

    zones.push({ tag, h2, subtitle, intro, keyAttractionsLabel, attractions, highlights, tipContent });
  }
  return zones;
}

// Extract extras section
function extractExtras(html) {
  const extrasId = 'id="extras"';
  const extrasIdx = html.indexOf(extrasId);
  if (extrasIdx === -1) return { sectionLabel: '', heading: '', description: '', items: [] };

  const sectionStart = html.lastIndexOf('<section', extrasIdx);
  const nextSection = html.indexOf('<section', extrasIdx + 10);
  const sectionHtml = nextSection !== -1
    ? html.substring(sectionStart, nextSection)
    : html.substring(sectionStart, html.indexOf('</main>'));

  const sectionLabelMatch = sectionHtml.match(/<span class="section-label">([^<]+)<\/span>/);
  const headingMatch = sectionHtml.match(/<h2>([^<]+)<\/h2>/);
  const descMatch = sectionHtml.match(/<h2>[^<]+<\/h2>\s*<p>([^<]+)<\/p>/);

  const items = [];
  for (const eid of EXTRA_IDS) {
    const eidStr = `id="${eid}"`;
    const cardIdx = sectionHtml.indexOf(eidStr);
    if (cardIdx === -1) {
      items.push({ h3: '', content: '', highlights: [] });
      continue;
    }
    // Find the info-card div containing this id
    const cardStart = sectionHtml.lastIndexOf('<div class="info-card', cardIdx);

    // Find the h3
    const h3Match = sectionHtml.substring(cardStart).match(/<h3>([\s\S]*?)<\/h3>/);
    const h3 = h3Match ? h3Match[1].trim() : '';

    // Content is between </h3> and <div class="zone-highlights"
    const h3EndIdx = sectionHtml.indexOf('</h3>', cardStart) + 5;
    const hlStartIdx = sectionHtml.indexOf('<div class="zone-highlights"', h3EndIdx);
    const content = hlStartIdx !== -1
      ? sectionHtml.substring(h3EndIdx, hlStartIdx).trim()
      : '';

    // Highlights
    const highlights = [];
    if (hlStartIdx !== -1) {
      const hlEndIdx = sectionHtml.indexOf('</div>', hlStartIdx) + 6;
      const hlHtml = sectionHtml.substring(hlStartIdx, hlEndIdx);
      const hlRegex = /<span class="zone-highlight">([^<]+)<\/span>/g;
      let hlM;
      while ((hlM = hlRegex.exec(hlHtml)) !== null) {
        highlights.push(hlM[1].trim());
      }
    }

    items.push({ h3, content, highlights });
  }

  return {
    sectionLabel: sectionLabelMatch ? sectionLabelMatch[1].trim() : '',
    heading:      headingMatch      ? headingMatch[1].trim()      : '',
    description:  descMatch         ? descMatch[1].trim()         : '',
    items,
  };
}

// Extract FAQ section
function extractFaq(html) {
  const faqId = 'id="faq"';
  const faqIdx = html.indexOf(faqId);
  if (faqIdx === -1) return { sectionLabel: '', heading: '', description: '', items: [], viewAll: '' };

  const mainEnd = html.indexOf('</main>');
  const sectionStart = html.lastIndexOf('<section', faqIdx);
  const nextSection = html.indexOf('<section', faqIdx + 10);
  const sectionHtml = (nextSection !== -1 && nextSection < mainEnd)
    ? html.substring(sectionStart, nextSection)
    : html.substring(sectionStart, mainEnd);

  const sectionLabelMatch = sectionHtml.match(/<span class="section-label">([^<]+)<\/span>/);
  const headingMatch      = sectionHtml.match(/<h2>([^<]+)<\/h2>/);
  const descMatch         = sectionHtml.match(/<h2>[^<]+<\/h2>\s*<p>([^<]+)<\/p>/);

  const items = [];
  const itemStarts = [];
  let idx = 0;
  while (true) {
    const pos = sectionHtml.indexOf('<div class="faq-item">', idx);
    if (pos === -1) break;
    itemStarts.push(pos);
    idx = pos + 1;
  }
  for (let i = 0; i < itemStarts.length; i++) {
    const start = itemStarts[i];
    const end   = i + 1 < itemStarts.length ? itemStarts[i + 1] : sectionHtml.length;
    const itemHtml = sectionHtml.substring(start, end);

    const qMatch = itemHtml.match(/<button[^>]*class="faq-question"[^>]*>\s*<span>([\s\S]*?)<\/span>/);
    const question = qMatch ? qMatch[1].trim() : '';

    const aMatch = itemHtml.match(/<div class="faq-answer-inner">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/);
    const answer = aMatch ? aMatch[1].trim() : '';

    if (question) items.push({ question, answer });
  }

  const viewAllMatch = sectionHtml.match(/<a[^>]*class="btn btn-primary"[^>]*>([^<]+)<\/a>/);
  const viewAll = viewAllMatch ? viewAllMatch[1].trim() : '';

  return {
    sectionLabel: sectionLabelMatch ? sectionLabelMatch[1].trim() : '',
    heading:      headingMatch      ? headingMatch[1].trim()      : '',
    description:  descMatch         ? descMatch[1].trim()         : '',
    items,
    viewAll,
  };
}

// Extract CTA section
function extractCta(html) {
  const ctaMatch = html.match(/<div class="cta-banner fade-in">([\s\S]*?)<\/div>\s*<\/div>\s*<\/section>/);
  if (!ctaMatch) return { heading: '', text: '', button: '', link: '' };
  const bannerHtml = ctaMatch[1];

  const h2Match  = bannerHtml.match(/<h2>([^<]+)<\/h2>/);
  const pMatch   = bannerHtml.match(/<h2>[^<]+<\/h2>\s*<p>([^<]+)<\/p>/);
  const btnMatch = bannerHtml.match(/class="btn btn-white[^"]*"[^>]*>([^<]+)<\/a>/);
  const linkMatch = bannerHtml.match(/<a href="[^"]*"[^>]*style="[^"]*">([^<]+)<\/a>/);

  return {
    heading: h2Match   ? h2Match[1].trim()   : '',
    text:    pMatch    ? pMatch[1].trim()     : '',
    button:  btnMatch  ? btnMatch[1].trim()   : '',
    link:    linkMatch ? linkMatch[1].trim()  : '',
  };
}

// Extract schema data from JSON-LD blocks
function extractSchema(html) {
  const result = {
    name: '',
    alternateName: [],
    description: '',
    touristType: [],
    containsPlace: [],
  };

  // Find all JSON-LD blocks
  const scriptRegex = /<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/g;
  let m;
  while ((m = scriptRegex.exec(html)) !== null) {
    try {
      const schema = JSON.parse(m[1]);
      if (schema['@type'] === 'TouristAttraction' && schema.containsPlace) {
        result.name        = schema.name        || '';
        result.description = schema.description || '';
        result.alternateName = Array.isArray(schema.alternateName) ? schema.alternateName : [];
        result.touristType   = Array.isArray(schema.touristType)   ? schema.touristType   : [];
        result.containsPlace = (schema.containsPlace || []).map(p => ({
          '@type':     'TouristAttraction',
          name:        p.name        || '',
          description: p.description || '',
        }));
      }
    } catch (e) {
      // skip malformed JSON-LD
    }
  }
  return result;
}

// Extract all attractions strings from one HTML file
function extractAttractions(html) {
  return {
    title:                extractTitle(html),
    metaDescription:      extractMeta(html, 'description'),
    metaKeywords:         extractMeta(html, 'keywords'),
    ogTitle:              extractMeta(html, 'og:title'),
    ogDescription:        extractMeta(html, 'og:description'),
    twitterTitle:         extractMeta(html, 'twitter:title'),
    twitterDescription:   extractMeta(html, 'twitter:description'),
    breadcrumbCurrent:    extractBreadcrumbCurrent(html),
    pageHeader:           extractPageHeader(html),
    tldr:                 extractTldr(html),
    zoneNav:              extractZoneNav(html),
    zones:                extractZones(html),
    extras:               extractExtras(html),
    faq:                  extractFaq(html),
    cta:                  extractCta(html),
    schema:               extractSchema(html),
  };
}

// Main
function main() {
  console.log('=== Extracting attractions i18n ===\n');

  for (const lang of SITE.languages) {
    const filePath = getAttrPath(lang.code);
    if (!fs.existsSync(filePath)) {
      console.warn(`  Missing: ${filePath}`);
      continue;
    }

    const html = fs.readFileSync(filePath, 'utf8');
    const attractions = extractAttractions(html);

    // Merge into existing i18n JSON
    const i18nPath = path.join(__dirname, 'i18n', `${lang.code}.json`);
    const existing = fs.existsSync(i18nPath)
      ? JSON.parse(fs.readFileSync(i18nPath, 'utf8'))
      : {};

    existing.attractions = attractions;

    fs.writeFileSync(i18nPath, JSON.stringify(existing, null, 2) + '\n');
    console.log(`  Extracted ${lang.code} → ${Object.keys(attractions).length} keys`);
  }

  console.log('\n=== Done ===');
}

main();
