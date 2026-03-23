#!/usr/bin/env node

/**
 * One-time extraction script: pulls translatable strings from existing
 * tickets.html files across all 12 languages and writes them to
 * src/i18n/{lang}.json under the "tickets" key.
 *
 * Run once: node src/extract-i18n-tickets.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITE = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'site.json'), 'utf8'));

function getTicketsPath(langCode) {
  return langCode === 'en'
    ? path.join(ROOT, 'tickets.html')
    : path.join(ROOT, langCode, 'tickets.html');
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

// Extract hero section strings
function extractHero(html) {
  const heroStart = html.indexOf('<section class="hero"');
  if (heroStart === -1) return {};
  const heroEnd = html.indexOf('</section>', heroStart);
  const heroHtml = html.substring(heroStart, heroEnd);

  // Badge: strip the emoji span
  const badgeMatch = heroHtml.match(/<div class="hero-badge">([\s\S]*?)<\/div>/);
  let badge = '';
  if (badgeMatch) {
    badge = badgeMatch[1]
      .replace(/<span[^>]*>[\s\S]*?<\/span>/g, '')
      .trim();
  }

  // h1 and h1Sub
  const h1Match = heroHtml.match(/<h1>([\s\S]*?)<\/h1>/);
  let h1 = '';
  let h1Sub = '';
  if (h1Match) {
    const h1Content = h1Match[1];
    const spanMatch = h1Content.match(/<span>([\s\S]*?)<\/span>/);
    if (spanMatch) {
      h1Sub = spanMatch[1].trim();
      h1 = h1Content.replace(/<span>[\s\S]*?<\/span>/, '').trim();
    } else {
      h1 = h1Content.trim();
    }
  }

  // hero-sub
  const subMatch = heroHtml.match(/<p class="hero-sub">([\s\S]*?)<\/p>/);
  const sub = subMatch ? subMatch[1].trim() : '';

  // CTAs
  const ctaGroupMatch = heroHtml.match(/<div class="hero-cta-group">([\s\S]*?)<\/div>/);
  let cta1 = '';
  let cta2 = '';
  if (ctaGroupMatch) {
    const ctaHtml = ctaGroupMatch[1];
    const links = ctaHtml.match(/<a[^>]*>([\s\S]*?)<\/a>/g) || [];
    if (links[0]) {
      cta1 = links[0].replace(/<[^>]+>/g, '').trim();
    }
    if (links[1]) {
      cta2 = links[1].replace(/<[^>]+>/g, '').trim();
    }
  }

  // Stats
  const stats = [];
  const statRegex = /<div class="hero-stat">\s*<span class="hero-stat-number">([\s\S]*?)<\/span>\s*<span class="hero-stat-label">([\s\S]*?)<\/span>\s*<\/div>/g;
  let m;
  while ((m = statRegex.exec(heroHtml)) !== null) {
    stats.push({ number: m[1].trim(), label: m[2].trim() });
  }

  return { badge, h1, h1Sub, sub, cta1, cta2, stats };
}

// Extract breadcrumb current label
function extractBreadcrumbCurrent(html) {
  const navMatch = html.match(/<nav class="section-sm" aria-label="Breadcrumb">([\s\S]*?)<\/nav>/);
  if (!navMatch) return '';
  const navHtml = navMatch[1];
  // Last span inside the breadcrumb
  const spans = navHtml.match(/<span>([^<]+)<\/span>/g) || [];
  if (spans.length > 0) {
    const lastSpan = spans[spans.length - 1];
    const m = lastSpan.match(/<span>([^<]+)<\/span>/);
    return m ? m[1].trim() : '';
  }
  return '';
}

// Extract TL;DR items from a tldr-box
function extractTldrItems(tldrHtml) {
  const items = [];
  const liRegex = /<li>([\s\S]*?)<\/li>/g;
  let m;
  while ((m = liRegex.exec(tldrHtml)) !== null) {
    const liContent = m[1].trim();
    const strongMatch = liContent.match(/^<strong>([\s\S]*?)<\/strong>([\s\S]*?)$/);
    if (strongMatch) {
      items.push({ bold: strongMatch[1].trim(), text: strongMatch[2].trim() });
    } else {
      // Plain text li (no strong)
      items.push({ bold: '', text: liContent });
    }
  }
  return items;
}

// Extract TL;DR section (first tldr-box in the page)
function extractTldr(html) {
  const mainStart = html.indexOf('<main id="main-content">');
  if (mainStart === -1) return [];
  const firstTldrStart = html.indexOf('<div class="tldr-box">', mainStart);
  if (firstTldrStart === -1) return [];
  const firstTldrEnd = html.indexOf('</div>', firstTldrStart);
  const tldrHtml = html.substring(firstTldrStart, firstTldrEnd);
  return extractTldrItems(tldrHtml);
}

// Extract ticket options section
function extractTicketOptions(html) {
  const sectionId = 'id="ticket-options"';
  const sectionIdx = html.indexOf(sectionId);
  if (sectionIdx === -1) return {};

  const sectionStart = html.lastIndexOf('<section', sectionIdx);
  const nextSection = html.indexOf('<section', sectionIdx + 10);
  const sectionHtml = nextSection !== -1
    ? html.substring(sectionStart, nextSection)
    : html.substring(sectionStart);

  const sectionLabelMatch = sectionHtml.match(/<span class="section-label">([^<]+)<\/span>/);
  const h2Match = sectionHtml.match(/<h2>([^<]+)<\/h2>/);
  const descMatch = sectionHtml.match(/<h2>[^<]+<\/h2>\s*<p>([\s\S]*?)<\/p>/);

  // Table headers
  const tableHeaders = [];
  const thRegex = /<th[^>]*>([^<]+)<\/th>/g;
  let m;
  while ((m = thRegex.exec(sectionHtml)) !== null) {
    tableHeaders.push(m[1].trim());
  }

  // Table rows
  const tableRows = [];
  const tbodyMatch = sectionHtml.match(/<tbody>([\s\S]*?)<\/tbody>/);
  if (tbodyMatch) {
    const tbodyHtml = tbodyMatch[1];
    const trRegex = /<tr>([\s\S]*?)<\/tr>/g;
    while ((m = trRegex.exec(tbodyHtml)) !== null) {
      const trHtml = m[1];
      const tds = [];
      const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/g;
      let td;
      while ((td = tdRegex.exec(trHtml)) !== null) {
        tds.push(td[1].trim());
      }
      if (tds.length >= 4) {
        // name: strip <strong>
        const name = tds[0].replace(/<[^>]+>/g, '').trim();
        // included: last td
        const included = tds[3].trim();
        tableRows.push({ name, included });
      }
    }
  }

  // Footnote
  const footnoteMatch = sectionHtml.match(/<p class="text-center text-sm text-muted"[^>]*>([\s\S]*?)<\/p>/);
  const tableFootnote = footnoteMatch ? footnoteMatch[1].trim() : '';

  // CTA button
  const ctaMatch = sectionHtml.match(/<a[^>]*data-booking[^>]*>([\s\S]*?)<\/a>/);
  const cta = ctaMatch ? ctaMatch[1].replace(/<[^>]+>/g, '').trim() : '';

  return {
    sectionLabel: sectionLabelMatch ? sectionLabelMatch[1].trim() : '',
    heading: h2Match ? h2Match[1].trim() : '',
    description: descMatch ? descMatch[1].trim() : '',
    tableHeaders,
    tableRows,
    tableFootnote,
    cta,
  };
}

// Extract pricing cards section
function extractPricingCards(html) {
  // Find "Best Value" section (section-gray after ticket-options)
  const ticketOptIdx = html.indexOf('id="ticket-options"');
  if (ticketOptIdx === -1) return {};

  const afterTicketOpt = html.indexOf('</section>', ticketOptIdx) + 10;
  const pricingStart = html.indexOf('<section', afterTicketOpt);
  if (pricingStart === -1) return {};

  const nextSectionAfter = html.indexOf('<section', pricingStart + 10);
  const sectionHtml = nextSectionAfter !== -1
    ? html.substring(pricingStart, nextSectionAfter)
    : html.substring(pricingStart);

  const sectionLabelMatch = sectionHtml.match(/<span class="section-label">([^<]+)<\/span>/);
  const h2Match = sectionHtml.match(/<h2>([^<]+)<\/h2>/);
  const descMatch = sectionHtml.match(/<h2>[^<]+<\/h2>\s*<p>([\s\S]*?)<\/p>/);

  // Extract pricing cards (not the outer pricing-cards wrapper)
  const cards = [];
  const cardStarts = [];
  let idx = 0;
  while (true) {
    const pos = sectionHtml.indexOf('<div class="pricing-card', idx);
    if (pos === -1) break;
    // Skip the outer wrapper div class="pricing-cards ..."
    const tagEnd = sectionHtml.indexOf('>', pos);
    const tagContent = sectionHtml.substring(pos, tagEnd + 1);
    if (!tagContent.includes('"pricing-cards ') && !tagContent.endsWith('"pricing-cards">')) {
      cardStarts.push(pos);
    }
    idx = pos + 1;
  }

  for (let i = 0; i < cardStarts.length; i++) {
    const start = cardStarts[i];
    // Find the end of this card - it's </div> at the right level
    // Just use next card start or section end
    const end = i + 1 < cardStarts.length ? cardStarts[i + 1] : sectionHtml.length;
    const cardHtml = sectionHtml.substring(start, end);

    const h3Match = cardHtml.match(/<h3>([^<]+)<\/h3>/);
    const h3 = h3Match ? h3Match[1].trim() : '';

    // Period: strip data-price-note attribute content (the value), get text
    const periodMatch = cardHtml.match(/<div class="pricing-period"[^>]*>([\s\S]*?)<\/div>/);
    const period = periodMatch ? periodMatch[1].trim() : '';

    // Features
    const features = [];
    const featuresMatch = cardHtml.match(/<div class="pricing-features">([\s\S]*?)<\/div>/);
    if (featuresMatch) {
      const liRegex = /<li>([\s\S]*?)<\/li>/g;
      let m;
      while ((m = liRegex.exec(featuresMatch[1])) !== null) {
        features.push(m[1].trim());
      }
    }

    // CTA: last btn in card
    let cta = '';
    const allCtaMatches = cardHtml.match(/<(?:a|span)[^>]*class="btn[^"]*"[^>]*>([\s\S]*?)<\/(?:a|span)>/g) || [];
    if (allCtaMatches.length > 0) {
      const lastCta = allCtaMatches[allCtaMatches.length - 1];
      cta = lastCta.replace(/<[^>]+>/g, '').trim();
    }

    cards.push({ h3, period, features, cta });
  }

  return {
    sectionLabel: sectionLabelMatch ? sectionLabelMatch[1].trim() : '',
    heading: h2Match ? h2Match[1].trim() : '',
    description: descMatch ? descMatch[1].trim() : '',
    cards,
  };
}

// Generic extraction for info-card sections (addons and how-to-book)
function extractInfoCardSection(sectionHtml) {
  const sectionLabelMatch = sectionHtml.match(/<span class="section-label">([^<]+)<\/span>/);
  const h2Match = sectionHtml.match(/<h2>([^<]+)<\/h2>/);
  // description: p after h2
  const descMatch = sectionHtml.match(/<h2>[\s\S]*?<\/h2>\s*<p>([\s\S]*?)<\/p>/);

  const items = [];
  const cardRegex = /<div class="info-card"[^>]*>([\s\S]*?)(?=<div class="info-card"|<\/div>\s*<\/div>\s*(?:<\/section>|<div class="text-center"))/g;
  let m;
  while ((m = cardRegex.exec(sectionHtml)) !== null) {
    const cardHtml = m[1];
    const h3Match = cardHtml.match(/<h3>([\s\S]*?)<\/h3>/);
    // Get the text p (not the icon div)
    // Find p after h3 or standalone p
    const pMatch = cardHtml.match(/<\/h3>\s*<p>([\s\S]*?)<\/p>/);
    const pMatch2 = !pMatch && cardHtml.match(/<p>([\s\S]*?)<\/p>/);
    // Also handle the div>h3>p structure in savings tips
    const divContent = cardHtml.match(/<div>\s*<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>/);

    if (divContent) {
      items.push({ h3: divContent[1].trim(), text: divContent[2].trim() });
    } else if (h3Match) {
      const text = pMatch ? pMatch[1].trim() : (pMatch2 ? pMatch2[1].trim() : '');
      items.push({ h3: h3Match[1].trim(), text });
    }
  }

  return {
    sectionLabel: sectionLabelMatch ? sectionLabelMatch[1].trim() : '',
    heading: h2Match ? h2Match[1].trim() : '',
    description: descMatch ? descMatch[1].trim() : '',
    items,
  };
}

// Extract addons section (after pricing cards)
function extractAddons(html) {
  // Find "Additional Activities" section
  const addonsIdx = html.indexOf('aria-label="Additional Activities"');
  if (addonsIdx === -1) return {};

  const sectionStart = html.lastIndexOf('<section', addonsIdx);
  const nextSection = html.indexOf('<section', addonsIdx + 10);
  const sectionHtml = nextSection !== -1
    ? html.substring(sectionStart, nextSection)
    : html.substring(sectionStart);

  return extractInfoCardSection(sectionHtml);
}

// Extract how to book section
function extractHowToBook(html) {
  const howIdx = html.indexOf('aria-label="How to Book"');
  if (howIdx === -1) return {};

  const sectionStart = html.lastIndexOf('<section', howIdx);
  const nextSection = html.indexOf('<section', howIdx + 10);
  const sectionHtml = nextSection !== -1
    ? html.substring(sectionStart, nextSection)
    : html.substring(sectionStart);

  const result = extractInfoCardSection(sectionHtml);

  // CTA button
  const ctaMatch = sectionHtml.match(/<a[^>]*data-booking[^>]*>([\s\S]*?)<\/a>/);
  result.cta = ctaMatch ? ctaMatch[1].replace(/<[^>]+>/g, '').trim() : '';

  // Description may include an <a> link for Klook - preserve HTML
  const descMatch = sectionHtml.match(/<h2>[\s\S]*?<\/h2>\s*<p>([\s\S]*?)<\/p>/);
  result.description = descMatch ? descMatch[1].trim() : '';

  return result;
}

// Extract cancellation section
function extractCancellation(html) {
  const cancelIdx = html.indexOf('aria-label="Cancellation Policy"');
  if (cancelIdx === -1) return {};

  const sectionStart = html.lastIndexOf('<section', cancelIdx);
  const nextSection = html.indexOf('<section', cancelIdx + 10);
  const sectionHtml = nextSection !== -1
    ? html.substring(sectionStart, nextSection)
    : html.substring(sectionStart);

  const sectionLabelMatch = sectionHtml.match(/<span class="section-label">([^<]+)<\/span>/);
  const h2Match = sectionHtml.match(/<h2>([^<]+)<\/h2>/);

  // TL;DR items
  const tldrStart = sectionHtml.indexOf('<div class="tldr-box">');
  const tldrEnd = sectionHtml.indexOf('</div>', tldrStart);
  const tldrHtml = tldrStart !== -1 ? sectionHtml.substring(tldrStart, tldrEnd) : '';
  const items = extractTldrItems(tldrHtml);

  // Footnote
  const footnoteMatch = sectionHtml.match(/<p class="text-center text-sm text-muted"[^>]*>([\s\S]*?)<\/p>/);
  const footerNote = footnoteMatch ? footnoteMatch[1].trim() : '';

  return {
    sectionLabel: sectionLabelMatch ? sectionLabelMatch[1].trim() : '',
    heading: h2Match ? h2Match[1].trim() : '',
    items,
    footerNote,
  };
}

// Extract savings tips section
function extractSavingsTips(html) {
  const tipsIdx = html.indexOf('aria-label="Money-Saving Tips"');
  if (tipsIdx === -1) return {};

  const sectionStart = html.lastIndexOf('<section', tipsIdx);
  const nextSection = html.indexOf('<section', tipsIdx + 10);
  const sectionHtml = nextSection !== -1
    ? html.substring(sectionStart, nextSection)
    : html.substring(sectionStart);

  const sectionLabelMatch = sectionHtml.match(/<span class="section-label">([^<]+)<\/span>/);
  const h2Match = sectionHtml.match(/<h2>([^<]+)<\/h2>/);
  const descMatch = sectionHtml.match(/<h2>[^<]+<\/h2>\s*<p>([^<]+)<\/p>/);

  // Tips: flex layout info-cards with inner <div> containing h3 and p
  const tips = [];
  const tipRegex = /<div class="info-card"[^>]*>[\s\S]*?<div>\s*<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>\s*<\/div>/g;
  let m;
  while ((m = tipRegex.exec(sectionHtml)) !== null) {
    tips.push({ h3: m[1].trim(), text: m[2].trim() });
  }

  // CTA link text
  const ctaMatch = sectionHtml.match(/<a[^>]*class="btn btn-primary"[^>]*>([^<]+)<\/a>/);
  const cta = ctaMatch ? ctaMatch[1].trim() : '';

  return {
    sectionLabel: sectionLabelMatch ? sectionLabelMatch[1].trim() : '',
    heading: h2Match ? h2Match[1].trim() : '',
    description: descMatch ? descMatch[1].trim() : '',
    tips,
    cta,
  };
}

// Extract CTA1 banner (first cta-banner in main content)
function extractCta1(html) {
  const mainStart = html.indexOf('<main id="main-content">');
  if (mainStart === -1) return {};

  const ctaBannerIdx = html.indexOf('<div class="cta-banner', mainStart);
  if (ctaBannerIdx === -1) return {};

  // Find the section containing this banner
  const sectionEnd = html.indexOf('</section>', ctaBannerIdx);
  const bannerHtml = html.substring(ctaBannerIdx, sectionEnd);

  const h2Match = bannerHtml.match(/<h2>([^<]+)<\/h2>/);
  const pMatches = bannerHtml.match(/<p>([\s\S]*?)<\/p>/g) || [];
  let text = '';
  if (pMatches[0]) {
    text = pMatches[0].replace(/<[^>]+>/g, '').trim();
  }

  const btnMatch = bannerHtml.match(/<a[^>]*class="btn btn-white[^"]*"[^>]*>([^<]+)<\/a>/);
  const button = btnMatch ? btnMatch[1].trim() : '';

  // subtextPrefix: text before <strong id="countdown"> (in p.text-sm)
  let subtextPrefix = '';
  const subtextMatch = bannerHtml.match(/<p[^>]*class="text-sm"[^>]*>([\s\S]*?)<strong id="countdown">/);
  if (subtextMatch) {
    subtextPrefix = subtextMatch[1].replace(/<[^>]+>/g, '').trim();
  }

  return {
    heading: h2Match ? h2Match[1].trim() : '',
    text,
    button,
    subtextPrefix,
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
  const headingMatch = sectionHtml.match(/<h2>([^<]+)<\/h2>/);
  const descMatch = sectionHtml.match(/<h2>[^<]+<\/h2>\s*<p>([^<]+)<\/p>/);

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
    const end = i + 1 < itemStarts.length ? itemStarts[i + 1] : sectionHtml.length;
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
    heading: headingMatch ? headingMatch[1].trim() : '',
    description: descMatch ? descMatch[1].trim() : '',
    items,
    viewAll,
  };
}

// Extract Price Guide section (second-to-last section before final CTA)
function extractPriceGuide(html) {
  const priceGuideIdx = html.indexOf('aria-label="Full Price Guide"');
  if (priceGuideIdx === -1) return {};

  const sectionStart = html.lastIndexOf('<section', priceGuideIdx);
  const nextSection = html.indexOf('<section', priceGuideIdx + 10);
  const sectionHtml = nextSection !== -1
    ? html.substring(sectionStart, nextSection)
    : html.substring(sectionStart);

  const h2Match = sectionHtml.match(/<h2>([^<]+)<\/h2>/);
  const pMatch = sectionHtml.match(/<h2>[^<]+<\/h2>\s*<p[^>]*>([\s\S]*?)<\/p>/);
  const btnMatch = sectionHtml.match(/<a[^>]*class="btn btn-primary[^"]*"[^>]*>([^<]+)<\/a>/);

  return {
    heading: h2Match ? h2Match[1].trim() : '',
    description: pMatch ? pMatch[1].trim() : '',
    button: btnMatch ? btnMatch[1].trim() : '',
  };
}

// Extract final CTA (last cta-banner)
function extractCta2(html) {
  const finalCtaIdx = html.indexOf('aria-label="Final Call to Action"');
  if (finalCtaIdx === -1) return {};

  const sectionStart = html.lastIndexOf('<section', finalCtaIdx);
  const mainEnd = html.indexOf('</main>');
  const sectionHtml = html.substring(sectionStart, mainEnd);

  const ctaBannerMatch = sectionHtml.match(/<div class="cta-banner[^"]*">([\s\S]*?)<\/div>/);
  if (!ctaBannerMatch) return {};

  const bannerHtml = ctaBannerMatch[1];
  const h2Match = bannerHtml.match(/<h2>([^<]+)<\/h2>/);
  const pMatch = bannerHtml.match(/<h2>[^<]+<\/h2>\s*<p>([^<]+)<\/p>/);
  const btnMatch = bannerHtml.match(/<a[^>]*class="btn btn-white[^"]*"[^>]*>([^<]+)<\/a>/);

  return {
    heading: h2Match ? h2Match[1].trim() : '',
    text: pMatch ? pMatch[1].trim() : '',
    button: btnMatch ? btnMatch[1].trim() : '',
  };
}

// Extract all tickets strings from one HTML file
function extractTickets(html) {
  const hero = extractHero(html);
  const breadcrumbCurrent = extractBreadcrumbCurrent(html);

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
    tldr: extractTldr(html),
    ticketOptions: extractTicketOptions(html),
    pricingCards: extractPricingCards(html),
    addons: extractAddons(html),
    howToBook: extractHowToBook(html),
    cancellation: extractCancellation(html),
    savingsTips: extractSavingsTips(html),
    cta1: extractCta1(html),
    faq: extractFaq(html),
    priceGuide: extractPriceGuide(html),
    cta2: extractCta2(html),
    schema: {
      breadcrumbCurrent,
    },
  };
}

// Main
function main() {
  console.log('=== Extracting tickets i18n ===\n');

  for (const lang of SITE.languages) {
    const filePath = getTicketsPath(lang.code);
    if (!fs.existsSync(filePath)) {
      console.warn(`  Missing: ${filePath}`);
      continue;
    }

    const html = fs.readFileSync(filePath, 'utf8');
    const tickets = extractTickets(html);

    // Merge into existing i18n JSON
    const i18nPath = path.join(__dirname, 'i18n', `${lang.code}.json`);
    const existing = fs.existsSync(i18nPath)
      ? JSON.parse(fs.readFileSync(i18nPath, 'utf8'))
      : {};

    existing.tickets = tickets;

    fs.writeFileSync(i18nPath, JSON.stringify(existing, null, 2) + '\n');
    console.log(`  Extracted ${lang.code} → tickets (hero, tldr, ${tickets.faq.items.length} FAQ items, etc.)`);
  }

  console.log('\n=== Done ===');
}

main();
