#!/usr/bin/env node

/**
 * One-time extraction script: pulls translatable strings from existing index.html
 * files across all 12 languages and merges them into src/i18n/{lang}.json under a "home" key.
 *
 * Run once: node src/extract-i18n-home.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITE = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'site.json'), 'utf8'));

function getIndexPath(langCode) {
  if (langCode === 'en') return path.join(ROOT, 'index.html');
  return path.join(ROOT, langCode, 'index.html');
}

function extractBetween(html, startPattern, endPattern) {
  const startIdx = html.indexOf(startPattern);
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

// ─── Hero Section ───
function extractHero(html) {
  const heroSection = extractBetween(html, '<section class="hero" role="banner">', '</section>');
  if (!heroSection) return {};

  const h1Match = heroSection.match(/<h1>([\s\S]*?)<\/h1>/);
  if (!h1Match) return {};

  const h1 = h1Match[1];

  // pretitle: <span class="hero-pretitle">...</span>
  const pretitleMatch = h1.match(/<span class="hero-pretitle">([^<]+)<\/span>/);
  const heroPreTitle = pretitleMatch ? pretitleMatch[1].trim() : '';

  // subtitle: <span class="hero-subtitle">...</span>
  const subtitleMatch = h1.match(/<span class="hero-subtitle">([^<]+)<\/span>/);
  const heroSubtitle = subtitleMatch ? subtitleMatch[1].trim() : '';

  // title: text between pretitle and subtitle spans
  let heroTitle = h1
    .replace(/<span class="hero-pretitle">[^<]*<\/span>/, '')
    .replace(/<span class="hero-subtitle">[^<]*<\/span>/, '')
    .trim();

  // CTA button text
  const ctaMatch = heroSection.match(/data-booking>\s*([\s\S]*?)\s*<\/a>/);
  const heroCta = ctaMatch ? ctaMatch[1].trim() : '';

  return { heroPreTitle, heroTitle, heroSubtitle, heroCta };
}

// ─── Stats Bar ───
function extractStats(html) {
  // Stats may be in a separate <section class="stats-bar"> (English)
  // or inside the hero section as <div class="hero-stats"> (translations)
  // Use the whole HTML and let the regex find all hero-stat divs
  const statsSection = html;

  const stats = [];
  const statRegex = /<div class="hero-stat">\s*<span class="hero-stat-number">([^<]+)<\/span>\s*<span class="hero-stat-label">([^<]+)<\/span>\s*<\/div>/g;
  let m;
  while ((m = statRegex.exec(statsSection)) !== null) {
    stats.push({ number: m[1].trim(), label: m[2].trim() });
  }
  return stats;
}

// ─── TL;DR Section ───
function extractTldr(html) {
  const tldrSection = extractBetween(html, '<div class="tldr-box">', '</div>');
  if (!tldrSection) return [];

  const items = [];
  const liRegex = /<li>([\s\S]*?)<\/li>/g;
  let m;
  while ((m = liRegex.exec(tldrSection)) !== null) {
    const content = m[1].trim();
    // Split into bold label and text
    const boldMatch = content.match(/<strong>([^<]+)<\/strong>\s*([\s\S]*)/);
    if (boldMatch) {
      items.push({ bold: boldMatch[1].trim(), text: boldMatch[2].trim() });
    } else {
      items.push({ bold: '', text: content });
    }
  }
  return items;
}

// ─── GBP Card ───
function extractGbp(html) {
  const gbpSection = extractBetween(html, '<div class="gbp-card', '<!-- Quick Facts -->');
  if (!gbpSection) {
    // Try alternate: some translations don't have the comment
    const alt = extractBetween(html, '<div class="gbp-card', '</div>\n\n');
    if (!alt) return {};
  }

  // Find the full gbp-card section more reliably
  const startIdx = html.indexOf('<div class="gbp-card');
  if (startIdx === -1) return {};
  // Find closing: look for the next sibling div (Quick Facts)
  const endMarkers = ['<!-- Quick Facts -->', '<div class="fade-in">', '<!-- Why Visit'];
  let endIdx = html.length;
  for (const marker of endMarkers) {
    const idx = html.indexOf(marker, startIdx + 100);
    if (idx !== -1 && idx < endIdx) endIdx = idx;
  }
  const section = html.substring(startIdx, endIdx);

  const category = (() => {
    const m = section.match(/<div class="gbp-category">([^<]+)<\/div>/);
    return m ? m[1].trim() : '';
  })();

  const ratingAriaLabel = (() => {
    const m = section.match(/<span class="stars" aria-label="([^"]+)">/);
    return m ? m[1].trim() : '';
  })();

  const ratingText = (() => {
    const m = section.match(/<span class="gbp-rating-text">([\s\S]*?)<\/span>/);
    return m ? m[1].trim() : '';
  })();

  // Extract detail items
  const details = [];
  const detailRegex = /<div class="gbp-detail">\s*<span[^>]*>[^<]*<\/span>\s*<div>([\s\S]*?)<\/div>\s*<\/div>/g;
  let dm;
  while ((dm = detailRegex.exec(section)) !== null) {
    details.push(dm[1].trim());
  }

  const statusText = (() => {
    const m = section.match(/data-park-status[^>]*>(?:<span[^>]*><\/span>)?([^<]+)<\/span>/);
    return m ? m[1].trim() : '';
  })();

  const ctaText = (() => {
    const m = section.match(/data-booking>([^<]+)<\/a>/);
    return m ? m[1].trim() : '';
  })();

  return { category, ratingAriaLabel, ratingText, details, statusText, ctaText };
}

// ─── Why Visit (Quick Facts) ───
function extractWhyVisit(html) {
  // Find the section after gbp-card - the right column
  const mainContent = extractBetween(html, '<main id="main-content">', '</main>');

  // Find "Why Visit" heading
  const h2Regex = /<h2>([^<]*(?:Why|為什麼|なぜ|왜|Почему|Warum|Pourquoi|Mengapa|Tại sao|क्यों|ເປັນ)[^<]*)<\/h2>/i;
  const h2Match = mainContent.match(h2Regex);

  // More generic: find the h2 in the fade-in div after gbp-card
  let heading = '';
  let introText = '';

  // Find the second column content
  const fadeInStart = mainContent.indexOf('</div>\n\n          <!-- Quick Facts -->');
  let whySection = '';

  if (fadeInStart !== -1) {
    whySection = mainContent.substring(fadeInStart, mainContent.indexOf('</section>', fadeInStart));
  } else {
    // Try to find by the h2 after gbp section
    const gbpEnd = mainContent.indexOf('</div>\n            </div>\n            <div style="margin-top: 1.5rem;">');
    if (gbpEnd !== -1) {
      const nextH2 = mainContent.indexOf('<h2>', gbpEnd);
      if (nextH2 !== -1) {
        whySection = mainContent.substring(nextH2, mainContent.indexOf('</section>', nextH2));
      }
    }
  }

  // If still not found, try broader approach
  if (!whySection) {
    // Find h2 that's between gbp-card closing and zones section
    const zonesStart = mainContent.indexOf('id="zones"');
    const gbpCardStart = mainContent.indexOf('class="gbp-card');
    if (gbpCardStart !== -1 && zonesStart !== -1) {
      whySection = mainContent.substring(gbpCardStart, zonesStart);
    }
  }

  // Extract heading
  const headingMatch = whySection.match(/<h2>([^<]+)<\/h2>/);
  heading = headingMatch ? headingMatch[1].trim() : '';

  // Extract intro paragraph (the one with mobile-hide or first <p> after h2)
  const introMatch = whySection.match(/<p[^>]*(?:class="mobile-hide")?[^>]*(?:style="[^"]*")?[^>]*>([\s\S]*?)<\/p>/);
  introText = introMatch ? introMatch[1].trim() : '';

  // Extract info cards
  const cards = [];
  const cardRegex = /<div class="info-card">\s*<div class="info-icon"[^>]*>[^<]*<\/div>\s*<h3>([^<]+)<\/h3>\s*<p>([^<]+)<\/p>\s*<\/div>/g;
  let cm;
  while ((cm = cardRegex.exec(whySection)) !== null) {
    cards.push({ heading: cm[1].trim(), text: cm[2].trim() });
  }

  return { heading, introText, cards };
}

// ─── Themed Zones ───
function extractZones(html) {
  const zonesSection = extractBetween(html, 'id="zones"', '</section>\n\n');
  if (!zonesSection) return {};

  // Section header
  const sectionLabel = (() => {
    const m = zonesSection.match(/<span class="section-label">([^<]+)<\/span>/);
    return m ? m[1].trim() : '';
  })();

  const heading = (() => {
    const m = zonesSection.match(/<h2>([^<]+)<\/h2>/);
    return m ? m[1].trim() : '';
  })();

  const description = (() => {
    const m = zonesSection.match(/<h2>[^<]+<\/h2>\s*<p>([^<]+)<\/p>/);
    return m ? m[1].trim() : '';
  })();

  // Zone cards
  const items = [];
  const cardStarts = [];
  let searchIdx = 0;
  while (true) {
    const idx = zonesSection.indexOf('<article class="zone-card', searchIdx);
    if (idx === -1) break;
    cardStarts.push(idx);
    searchIdx = idx + 1;
  }

  // CSS class mapping (order matches the zone cards in HTML)
  const cssClasses = [
    'zone-hotel-t', 'zone-ghostbusters', 'zone-zombieland', 'zone-jumanji',
    'zone-surfs-up', 'zone-cloudy', 'zone-bad-boys', 'zone-emoji', 'zone-wave-pool'
  ];

  for (let i = 0; i < cardStarts.length; i++) {
    const start = cardStarts[i];
    const end = i + 1 < cardStarts.length ? cardStarts[i + 1] : zonesSection.length;
    const card = zonesSection.substring(start, end);

    const tag = (() => {
      const m = card.match(/<span class="zone-tag">([^<]+)<\/span>/);
      return m ? m[1].trim() : '';
    })();

    const name = (() => {
      const m = card.match(/<h3>([^<]+)<\/h3>/);
      return m ? m[1].trim() : '';
    })();

    const desc = (() => {
      const m = card.match(/<h3>[^<]+<\/h3>\s*<p>([\s\S]*?)<\/p>/);
      return m ? m[1].trim() : '';
    })();

    // Highlights
    const highlights = [];
    const hlRegex = /<span class="zone-highlight">([^<]+)<\/span>/g;
    let hm;
    while ((hm = hlRegex.exec(card)) !== null) {
      const text = hm[1].trim();
      // Split emoji from label (first character/emoji + rest)
      const parts = text.match(/^(\S+)\s+(.*)/);
      if (parts) {
        highlights.push({ emoji: parts[1], label: parts[2] });
      } else {
        highlights.push({ emoji: '', label: text });
      }
    }

    items.push({
      cssClass: cssClasses[i] || '',
      tag,
      name,
      description: desc,
      highlights
    });
  }

  // View all link text
  const viewAll = (() => {
    const m = zonesSection.match(/<a href="[^"]*attractions[^"]*"[^>]*>([^<]+)<\/a>/);
    return m ? m[1].trim() : '';
  })();

  return { sectionLabel, heading, description, items, viewAll };
}

// ─── Tickets Section ───
function extractTickets(html) {
  const ticketsSection = extractBetween(html, 'id="tickets"', '</section>\n\n');
  if (!ticketsSection) return {};

  const sectionLabel = (() => {
    const m = ticketsSection.match(/<span class="section-label">([^<]+)<\/span>/);
    return m ? m[1].trim() : '';
  })();

  const heading = (() => {
    const m = ticketsSection.match(/<h2>([^<]+)<\/h2>/);
    return m ? m[1].trim() : '';
  })();

  const description = (() => {
    const m = ticketsSection.match(/<h2>[^<]+<\/h2>\s*<p>([^<]+)<\/p>/);
    return m ? m[1].trim() : '';
  })();

  // Pricing cards
  const cards = [];
  const cardStarts = [];
  let searchIdx = 0;
  while (true) {
    // Match <div class="pricing-card"> or <div class="pricing-card featured">
    // but NOT <div class="pricing-cards ...">
    let idx = -1;
    let tryIdx = searchIdx;
    while (tryIdx < ticketsSection.length) {
      const found = ticketsSection.indexOf('<div class="pricing-card', tryIdx);
      if (found === -1) break;
      const afterClass = ticketsSection.substring(found + 24, found + 40);
      // Match "pricing-card" or "pricing-card featured" but not "pricing-cards"
      if (afterClass[0] === '"' || afterClass[0] === ' ') {
        idx = found;
        break;
      }
      tryIdx = found + 1;
    }
    if (idx === -1) break;
    cardStarts.push(idx);
    searchIdx = idx + 1;
  }

  for (let i = 0; i < cardStarts.length; i++) {
    const start = cardStarts[i];
    const end = i + 1 < cardStarts.length ? cardStarts[i + 1] : ticketsSection.indexOf('</div>\n\n', start + 200);
    const card = ticketsSection.substring(start, end);

    const cardHeading = (() => {
      const m = card.match(/<h3>([^<]+)<\/h3>/);
      return m ? m[1].trim() : '';
    })();

    const periodText = (() => {
      const m = card.match(/<div class="pricing-period"[^>]*>([^<]+)<\/div>/);
      return m ? m[1].trim() : '';
    })();

    const features = [];
    const featureRegex = /<li>([^<]+)<\/li>/g;
    let fm;
    while ((fm = featureRegex.exec(card)) !== null) {
      features.push(fm[1].trim());
    }

    // Button/CTA text
    const ctaMatch = card.match(/(?:data-booking>|cursor: default;">)([^<]+)<\/(?:a|span)>/);
    const ctaText = ctaMatch ? ctaMatch[1].trim() : '';

    cards.push({ heading: cardHeading, periodText, features, ctaText });
  }

  // Footer note
  const footerNote = (() => {
    const m = ticketsSection.match(/<p class="text-center text-sm text-muted"[^>]*>([\s\S]*?)<\/p>/);
    return m ? m[1].trim() : '';
  })();

  return { sectionLabel, heading, description, cards, footerNote };
}

// ─── Getting There ───
function extractGettingThere(html) {
  // Find the section after tickets that contains transport info cards
  // It's between tickets section and comparison/reviews section
  const mainContent = extractBetween(html, '<main id="main-content">', '</main>');
  if (!mainContent) return {};

  // Find the getting-there comment or section
  let sectionHtml = '';
  const gtComment = mainContent.indexOf('<!-- How to Get There');
  if (gtComment !== -1) {
    const sectionEnd = mainContent.indexOf('</section>', gtComment);
    if (sectionEnd !== -1) {
      sectionHtml = mainContent.substring(gtComment, sectionEnd + '</section>'.length);
    }
  }

  if (!sectionHtml) {
    // Find by getting-there link
    const gtLink = mainContent.indexOf('getting-there.html');
    if (gtLink !== -1) {
      const sectionStart = mainContent.lastIndexOf('<section', gtLink);
      const sectionEnd = mainContent.indexOf('</section>', gtLink);
      if (sectionStart !== -1 && sectionEnd !== -1) {
        sectionHtml = mainContent.substring(sectionStart, sectionEnd + '</section>'.length);
      }
    }
  }

  if (!sectionHtml) return {};

  const sectionLabel = (() => {
    const m = sectionHtml.match(/<span class="section-label">([^<]+)<\/span>/);
    return m ? m[1].trim() : '';
  })();

  const heading = (() => {
    const m = sectionHtml.match(/<h2>([^<]+)<\/h2>/);
    return m ? m[1].trim() : '';
  })();

  const description = (() => {
    const m = sectionHtml.match(/<h2>[^<]+<\/h2>\s*<p>([^<]+)<\/p>/);
    return m ? m[1].trim() : '';
  })();

  const cards = [];
  const cardRegex = /<div class="info-card">\s*<div class="info-icon"[^>]*>([^<]*)<\/div>\s*<h3>([^<]+)<\/h3>\s*<p>([\s\S]*?)<\/p>\s*<\/div>/g;
  let cm;
  while ((cm = cardRegex.exec(sectionHtml)) !== null) {
    cards.push({ emoji: cm[1].trim(), heading: cm[2].trim(), text: cm[3].trim() });
  }

  const viewAll = (() => {
    const m = sectionHtml.match(/<a href="[^"]*getting-there[^"]*"[^>]*>([^<]+)<\/a>/);
    return m ? m[1].trim() : '';
  })();

  return { sectionLabel, heading, description, cards, viewAll };
}

// ─── Comparison Table ───
function extractComparison(html) {
  let section = extractBetween(html, 'aria-label="Water Park Comparison"', '</section>');
  if (!section) {
    // Find by table element - find section containing a <table>
    const tableIdx = html.indexOf('<table>');
    if (tableIdx !== -1) {
      const sectionStart = html.lastIndexOf('<section', tableIdx);
      const sectionEnd = html.indexOf('</section>', tableIdx);
      if (sectionStart !== -1 && sectionEnd !== -1) {
        section = html.substring(sectionStart, sectionEnd);
      }
    }
  }
  if (!section) return null;

  const sectionLabel = (() => {
    const m = section.match(/<span class="section-label">([^<]+)<\/span>/);
    return m ? m[1].trim() : '';
  })();

  const heading = (() => {
    const m = section.match(/<h2>([^<]+)<\/h2>/);
    return m ? m[1].trim() : '';
  })();

  const description = (() => {
    const m = section.match(/<h2>[^<]+<\/h2>\s*<p>([^<]+)<\/p>/);
    return m ? m[1].trim() : '';
  })();

  // Table headers
  const headers = [];
  const thRegex = /<th[^>]*>([^<]+)<\/th>/g;
  let thm;
  while ((thm = thRegex.exec(section)) !== null) {
    headers.push(thm[1].trim());
  }

  // Table rows
  const rows = [];
  const trRegex = /<tr>\s*<td><strong>([^<]+)<\/strong><\/td>\s*<td>([^<]+)<\/td>\s*<td>([^<]+)<\/td>\s*<\/tr>/g;
  let trm;
  while ((trm = trRegex.exec(section)) !== null) {
    rows.push({ feature: trm[1].trim(), aquaverse: trm[2].trim(), ramayana: trm[3].trim() });
  }

  const compareLink = (() => {
    const m = section.match(/<a href="[^"]*aquaverse-vs-ramayana[^"]*"[^>]*>([^<]+)<\/a>/);
    return m ? m[1].trim() : '';
  })();

  return { sectionLabel, heading, description, headers, rows, compareLink };
}

// ─── Visitor Reviews ───
function extractReviews(html) {
  // aria-label varies by language, so find by testimonials-grid class
  let section = extractBetween(html, 'aria-label="Visitor Reviews"', '</section>');
  if (!section) {
    // Find section containing testimonials-grid
    const tgIdx = html.indexOf('class="testimonials-grid');
    if (tgIdx !== -1) {
      // Go back to find the section start
      const sectionStart = html.lastIndexOf('<section', tgIdx);
      const sectionEnd = html.indexOf('</section>', tgIdx);
      if (sectionStart !== -1 && sectionEnd !== -1) {
        section = html.substring(sectionStart, sectionEnd);
      }
    }
  }
  if (!section) return {};

  const sectionLabel = (() => {
    const m = section.match(/<span class="section-label">([^<]+)<\/span>/);
    return m ? m[1].trim() : '';
  })();

  const heading = (() => {
    const m = section.match(/<h2>([^<]+)<\/h2>/);
    return m ? m[1].trim() : '';
  })();

  const description = (() => {
    const m = section.match(/<h2>[^<]+<\/h2>\s*<p>([^<]+)<\/p>/);
    return m ? m[1].trim() : '';
  })();

  const testimonials = [];
  const cardStarts = [];
  let searchIdx = 0;
  while (true) {
    const idx = section.indexOf('<div class="testimonial-card">', searchIdx);
    if (idx === -1) break;
    cardStarts.push(idx);
    searchIdx = idx + 1;
  }

  for (let i = 0; i < cardStarts.length; i++) {
    const start = cardStarts[i];
    const end = i + 1 < cardStarts.length ? cardStarts[i + 1] : section.length;
    const card = section.substring(start, end);

    const stars = (() => {
      const m = card.match(/aria-label="([^"]+)"/);
      return m ? m[1].trim() : '';
    })();

    const text = (() => {
      const m = card.match(/<p class="testimonial-text">([^<]+)<\/p>/);
      return m ? m[1].trim() : '';
    })();

    // Handle text with HTML entities
    const textAlt = (() => {
      const m = card.match(/<p class="testimonial-text">([\s\S]*?)<\/p>/);
      return m ? m[1].trim() : '';
    })();

    const name = (() => {
      const m = card.match(/<div class="testimonial-name">([^<]+)<\/div>/);
      return m ? m[1].trim() : '';
    })();

    const initials = (() => {
      const m = card.match(/<div class="testimonial-avatar">([^<]+)<\/div>/);
      return m ? m[1].trim() : '';
    })();

    const source = (() => {
      const m = card.match(/<div class="testimonial-source">([^<]+)<\/div>/);
      return m ? m[1].trim() : '';
    })();

    testimonials.push({
      stars,
      text: textAlt || text,
      initials,
      name,
      source
    });
  }

  return { sectionLabel, heading, description, testimonials };
}

// ─── Blog Preview ───
function extractBlog(html) {
  let section = extractBetween(html, 'aria-label="Travel Guides"', '</section>');
  if (!section) {
    // Find section containing blog-grid
    const bgIdx = html.indexOf('class="blog-grid');
    if (bgIdx !== -1) {
      const sectionStart = html.lastIndexOf('<section', bgIdx);
      const sectionEnd = html.indexOf('</section>', bgIdx);
      if (sectionStart !== -1 && sectionEnd !== -1) {
        section = html.substring(sectionStart, sectionEnd);
      }
    }
  }
  if (!section) return null;

  const sectionLabel = (() => {
    const m = section.match(/<span class="section-label">([^<]+)<\/span>/);
    return m ? m[1].trim() : '';
  })();

  const heading = (() => {
    const m = section.match(/<h2>([^<]+)<\/h2>/);
    return m ? m[1].trim() : '';
  })();

  const description = (() => {
    const m = section.match(/<h2>[^<]+<\/h2>\s*<p>([^<]+)<\/p>/);
    return m ? m[1].trim() : '';
  })();

  const cards = [];
  const cardStarts = [];
  let searchIdx = 0;
  while (true) {
    const idx = section.indexOf('<article class="blog-card">', searchIdx);
    if (idx === -1) break;
    cardStarts.push(idx);
    searchIdx = idx + 1;
  }

  for (let i = 0; i < cardStarts.length; i++) {
    const start = cardStarts[i];
    const end = i + 1 < cardStarts.length ? cardStarts[i + 1] : section.indexOf('</div>\n\n', start + 200);
    const card = section.substring(start, end);

    const tag = (() => {
      const m = card.match(/<span class="blog-tag">([^<]+)<\/span>/);
      return m ? m[1].trim() : '';
    })();

    const readTime = (() => {
      const m = card.match(/<span>(\d+\s*\S+\s*\S*)<\/span>/);
      return m ? m[1].trim() : '';
    })();

    const title = (() => {
      const m = card.match(/<h3><a[^>]*>([^<]+)<\/a><\/h3>/);
      return m ? m[1].trim() : '';
    })();

    const desc = (() => {
      const m = card.match(/<\/h3>\s*<p>([\s\S]*?)<\/p>/);
      return m ? m[1].trim() : '';
    })();

    cards.push({ tag, readTime, title, description: desc });
  }

  const viewAll = (() => {
    const m = section.match(/<a href="[^"]*blog\/"[^>]*>([^<]+)<\/a>/);
    return m ? m[1].trim() : '';
  })();

  return { sectionLabel, heading, description, cards, viewAll };
}

// ─── FAQ Section (home page version) ───
function extractHomeFaq(html) {
  const section = extractBetween(html, 'id="faq"', '</section>\n\n');
  if (!section) return {};

  const sectionLabel = (() => {
    const m = section.match(/<span class="section-label">([^<]+)<\/span>/);
    return m ? m[1].trim() : '';
  })();

  const heading = (() => {
    const m = section.match(/<h2>([^<]+)<\/h2>/);
    return m ? m[1].trim() : '';
  })();

  const description = (() => {
    const m = section.match(/<h2>[^<]+<\/h2>\s*<p>([^<]+)<\/p>/);
    return m ? m[1].trim() : '';
  })();

  // FAQ items
  const items = [];
  const itemStarts = [];
  let searchIdx = 0;
  while (true) {
    const idx = section.indexOf('<div class="faq-item">', searchIdx);
    if (idx === -1) break;
    itemStarts.push(idx);
    searchIdx = idx + 1;
  }

  for (let i = 0; i < itemStarts.length; i++) {
    const start = itemStarts[i];
    const end = i + 1 < itemStarts.length ? itemStarts[i + 1] : section.length;
    const itemHtml = section.substring(start, end);

    const question = (() => {
      const m = itemHtml.match(/<button[^>]*>\s*<span>([\s\S]*?)<\/span>/);
      return m ? m[1].trim() : '';
    })();

    const answer = (() => {
      const m = itemHtml.match(/<div class="faq-answer-inner">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/);
      return m ? m[1].trim() : '';
    })();

    if (question) {
      items.push({ question, answer });
    }
  }

  const viewAll = (() => {
    const m = section.match(/<a href="[^"]*faq[^"]*"[^>]*>([^<]+)<\/a>/);
    return m ? m[1].trim() : '';
  })();

  return { sectionLabel, heading, description, items, viewAll };
}

// ─── CTA Banner ───
function extractCta(html) {
  const mainContent = extractBetween(html, '<main id="main-content">', '</main>');
  if (!mainContent) return {};

  // Find CTA banner section
  const ctaBannerStart = mainContent.indexOf('<div class="cta-banner');
  if (ctaBannerStart === -1) return {};

  const ctaSection = mainContent.substring(ctaBannerStart, mainContent.indexOf('</section>', ctaBannerStart));

  const ctaTitle = (() => {
    const m = ctaSection.match(/<h2>([^<]+)<\/h2>/);
    return m ? m[1].trim() : '';
  })();

  const ctaText = (() => {
    const m = ctaSection.match(/<h2>[^<]+<\/h2>\s*<p>([^<]+)<\/p>/);
    return m ? m[1].trim() : '';
  })();

  const ctaButton = (() => {
    const m = ctaSection.match(/data-booking>([^<]+)<\/a>/);
    return m ? m[1].trim() : '';
  })();

  const ctaSubtext = (() => {
    const m = ctaSection.match(/<p class="text-sm"[^>]*>([\s\S]*?)<\/p>/);
    return m ? m[1].trim() : '';
  })();

  return { ctaTitle, ctaText, ctaButton, ctaSubtext };
}

// ─── Nearby Attractions ───
function extractNearby(html) {
  let section = extractBetween(html, 'aria-label="Nearby Attractions"', '</section>');
  if (!section) {
    // Find by the "Nearby" comment
    const nearbyComment = html.indexOf('<!-- Nearby Attractions');
    if (nearbyComment !== -1) {
      const sectionEnd = html.indexOf('</section>', nearbyComment);
      if (sectionEnd !== -1) {
        section = html.substring(nearbyComment, sectionEnd);
      }
    }
  }
  if (!section) return null;

  const sectionLabel = (() => {
    const m = section.match(/<span class="section-label">([^<]+)<\/span>/);
    return m ? m[1].trim() : '';
  })();

  const heading = (() => {
    const m = section.match(/<h2>([^<]+)<\/h2>/);
    return m ? m[1].trim() : '';
  })();

  const description = (() => {
    const m = section.match(/<h2>[^<]+<\/h2>\s*<p>([^<]+)<\/p>/);
    return m ? m[1].trim() : '';
  })();

  const cards = [];
  const cardRegex = /<div class="info-card">\s*<div class="info-icon"[^>]*>([^<]*)<\/div>\s*<h3>([^<]+)<\/h3>\s*<p>([^<]+)<\/p>\s*<\/div>/g;
  let cm;
  while ((cm = cardRegex.exec(section)) !== null) {
    cards.push({ emoji: cm[1].trim(), heading: cm[2].trim(), text: cm[3].trim() });
  }

  return { sectionLabel, heading, description, cards };
}

// ─── Schema description (from AmusementPark schema) ───
function extractSchemaDescription(html) {
  // Extract from AmusementPark schema
  const schemaMatch = html.match(/"@type":\s*"AmusementPark"[\s\S]*?"description":\s*"([^"]+)"/);
  return schemaMatch ? schemaMatch[1] : '';
}

// ─── Main extraction for one language ───
function extractForLang(langCode) {
  const indexPath = getIndexPath(langCode);
  if (!fs.existsSync(indexPath)) {
    console.log(`  Skipping ${langCode}: ${indexPath} not found`);
    return null;
  }

  const html = fs.readFileSync(indexPath, 'utf8');
  console.log(`  Processing ${langCode} (${indexPath})`);

  const hero = extractHero(html);
  const stats = extractStats(html);
  const tldr = extractTldr(html);
  const gbp = extractGbp(html);
  const whyVisit = extractWhyVisit(html);
  const zones = extractZones(html);
  const tickets = extractTickets(html);
  const gettingThere = extractGettingThere(html);
  const comparison = extractComparison(html);
  const reviews = extractReviews(html);
  const blog = extractBlog(html);
  const faq = extractHomeFaq(html);
  const cta = extractCta(html);
  const nearby = extractNearby(html);
  const schemaDescription = extractSchemaDescription(html);

  const home = {
    // SEO
    title: extractTitle(html),
    metaDescription: extractMeta(html, 'description'),
    metaKeywords: extractMeta(html, 'keywords'),
    ogTitle: extractMeta(html, 'og:title'),
    ogDescription: extractMeta(html, 'og:description'),
    twitterTitle: extractMeta(html, 'twitter:title'),
    twitterDescription: extractMeta(html, 'twitter:description'),
    schemaDescription,

    // Hero
    ...hero,

    // Stats
    stats,

    // TL;DR
    tldr,

    // GBP Card
    gbp,

    // Why Visit
    whyVisit,

    // Zones
    zones,

    // Tickets
    tickets,

    // Getting There
    gettingThere,

    // Comparison (null if not present - some translations may lack it)
    comparison,

    // Reviews
    reviews,

    // Blog (null if not present)
    blog,

    // FAQ
    faq,

    // CTA
    cta,

    // Nearby (null if not present)
    nearby
  };

  return home;
}

// ─── Main ───
console.log('=== Extracting i18n (home) from index.html pages ===\n');

const langs = SITE.languages.map(l => l.code);
for (const lang of langs) {
  const homeData = extractForLang(lang);
  if (!homeData) continue;

  const i18nPath = path.join(__dirname, 'i18n', `${lang}.json`);
  const existing = JSON.parse(fs.readFileSync(i18nPath, 'utf8'));
  existing.home = homeData;
  fs.writeFileSync(i18nPath, JSON.stringify(existing, null, 2) + '\n', 'utf8');
  console.log(`  -> Merged home data into ${i18nPath}\n`);
}

console.log('=== Done ===');
