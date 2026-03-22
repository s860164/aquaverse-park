#!/usr/bin/env node

/**
 * One-time extraction script: pulls translatable strings from existing FAQ HTML
 * files across all 12 languages and writes them to src/i18n/{lang}.json.
 *
 * Run once: node src/extract-i18n.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITE = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'site.json'), 'utf8'));

function getFaqPath(langCode) {
  if (langCode === 'en') return path.join(ROOT, 'faq.html');
  return path.join(ROOT, langCode, 'faq.html');
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
  // Match both name="" and property="" attributes
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

function extractNavLabels(html) {
  // Extract nav links from the navbar section
  const navSection = extractBetween(html, '<div class="nav-links" id="navLinks">', '</div>');
  if (!navSection) return {};

  const labels = {};
  const linkRegex = /<a\s+href="[^"]*"[^>]*>([^<]+)<\/a>/g;
  let m;
  const keys = ['home', 'attractions', 'tickets', 'gettingThere', 'tips', 'faq', 'blog'];
  let i = 0;
  while ((m = linkRegex.exec(navSection)) !== null) {
    if (i < keys.length) {
      labels[keys[i]] = m[1].trim();
      i++;
    }
  }

  // Extract CTA button text
  const ctaMatch = navSection.match(/class="nav-cta[^"]*"[^>]*>([^<]+)</);
  if (ctaMatch) labels.bookTickets = ctaMatch[1].trim();

  return labels;
}

function extractAnnouncementBar(html) {
  const section = extractBetween(html, '<div class="announcement-bar">', '</div>');
  if (!section) return { text: '', linkText: '' };

  // Split into text and link
  const linkMatch = section.match(/<a[^>]*>([^<]+)<\/a>/);
  const linkText = linkMatch ? linkMatch[1].trim() : '';

  // Text before the link
  let text = section.replace(/<a[^>]*>[^<]*<\/a>/, '').trim();
  // Clean up any remaining HTML
  text = text.replace(/<[^>]+>/g, '').trim();

  return { text, linkText };
}

function extractHeroSection(html) {
  const heroSection = extractBetween(html, '<section class="hero hero-sm"', '</section>');
  if (!heroSection) return {};

  // Breadcrumb home label
  const breadcrumbHome = (() => {
    const m = heroSection.match(/<a[^>]*>([^<]+)<\/a>\s*<span/);
    return m ? m[1].trim() : '';
  })();

  // Breadcrumb current page label
  const breadcrumbCurrent = (() => {
    const m = heroSection.match(/<span aria-current="page">([^<]+)<\/span>/);
    return m ? m[1].trim() : '';
  })();

  // h1 title and subtitle
  const h1Match = heroSection.match(/<h1>\s*([\s\S]*?)\s*<\/h1>/);
  let heroTitle = '';
  let heroSubtitle = '';
  if (h1Match) {
    const h1Content = h1Match[1];
    // Title is text before <span>, subtitle is inside <span>
    heroTitle = h1Content.replace(/<span>[\s\S]*<\/span>/, '').trim();
    const spanMatch = h1Content.match(/<span>([\s\S]*?)<\/span>/);
    if (spanMatch) heroSubtitle = spanMatch[1].trim();
  }

  // Hero text paragraph
  const heroText = (() => {
    const m = heroSection.match(/<p class="hero-sub">([\s\S]*?)<\/p>/);
    return m ? m[1].trim() : '';
  })();

  return { breadcrumbHome, breadcrumbCurrent, heroTitle, heroSubtitle, heroText };
}

function extractFaqCategories(html) {
  const categories = [];

  // Find all FAQ category sections
  const mainContent = extractBetween(html, '<main id="main-content">', '</main>');
  if (!mainContent) return categories;

  // Extract jump navigation labels
  const jumpSection = extractBetween(mainContent, 'Jump to a Category', '</section>');
  const jumpAltSection = extractBetween(mainContent, 'カテゴリ', '</section>') ||
                         extractBetween(mainContent, '快速跳轉', '</section>') ||
                         extractBetween(mainContent, '跳至分類', '</section>');

  // Find FAQ sections by their id attributes
  const sectionRegex = /<section\s+class="section(?:\s+section-gray)?"\s+id="([^"]+)"\s+aria-label="[^"]*">/g;
  let sectionMatch;
  const sectionStarts = [];

  while ((sectionMatch = sectionRegex.exec(mainContent)) !== null) {
    sectionStarts.push({
      id: sectionMatch[1],
      index: sectionMatch.index,
      fullMatch: sectionMatch[0]
    });
  }

  for (let s = 0; s < sectionStarts.length; s++) {
    const start = sectionStarts[s];
    const endIdx = s + 1 < sectionStarts.length
      ? sectionStarts[s + 1].index
      : mainContent.indexOf('<!-- Still Have Questions') !== -1
        ? mainContent.indexOf('<!-- Still Have Questions')
        : mainContent.indexOf('<!-- CTA Banner');

    const sectionHtml = mainContent.substring(start.index, endIdx);

    // Extract section label (Category N)
    const labelMatch = sectionHtml.match(/<span class="section-label">([^<]+)<\/span>/);
    const sectionLabel = labelMatch ? labelMatch[1].trim() : `Category ${s + 1}`;

    // Extract heading
    const headingMatch = sectionHtml.match(/<h2>([^<]+)<\/h2>/);
    const heading = headingMatch ? headingMatch[1].trim() : '';

    // Extract description
    const descMatch = sectionHtml.match(/<h2>[^<]+<\/h2>\s*<p>([^<]+)<\/p>/);
    const description = descMatch ? descMatch[1].trim() : '';

    // Extract FAQ items
    const questions = [];
    const faqItemRegex = /<div class="faq-item">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g;
    let faqMatch;

    // More robust: find each faq-item
    const itemStarts = [];
    let searchIdx = 0;
    while (true) {
      const idx = sectionHtml.indexOf('<div class="faq-item">', searchIdx);
      if (idx === -1) break;
      itemStarts.push(idx);
      searchIdx = idx + 1;
    }

    for (let q = 0; q < itemStarts.length; q++) {
      const itemStart = itemStarts[q];
      const itemEnd = q + 1 < itemStarts.length ? itemStarts[q + 1] : sectionHtml.length;
      const itemHtml = sectionHtml.substring(itemStart, itemEnd);

      // Extract question text
      const questionMatch = itemHtml.match(/<button[^>]*class="faq-question"[^>]*>\s*<span>([\s\S]*?)<\/span>/);
      const question = questionMatch ? questionMatch[1].trim() : '';

      // Extract answer HTML (inside faq-answer-inner)
      const answerMatch = itemHtml.match(/<div class="faq-answer-inner">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/);
      let answer = '';
      if (answerMatch) {
        answer = answerMatch[1].trim();
      }

      if (question) {
        questions.push({ question, answer });
      }
    }

    categories.push({
      id: start.id,
      sectionLabel,
      heading,
      description,
      questions
    });
  }

  return categories;
}

function extractJumpLabels(html) {
  const mainContent = extractBetween(html, '<main id="main-content">', '</main>');
  if (!mainContent) return {};

  // Find the jump-to section
  const jumpSection = extractBetween(mainContent, '<section class="section-sm"', '</section>');
  if (!jumpSection) return {};

  const titleMatch = jumpSection.match(/<h2[^>]*>([^<]+)<\/h2>/);
  const jumpTitle = titleMatch ? titleMatch[1].trim() : '';

  const labels = {};
  const btnRegex = /<a href="#([^"]+)"[^>]*>([^<]+)<\/a>/g;
  let m;
  while ((m = btnRegex.exec(jumpSection)) !== null) {
    labels[m[1]] = m[2].trim();
  }

  return { jumpTitle, jumpLabels: labels };
}

function extractStillHaveQuestions(html) {
  const mainContent = extractBetween(html, '<main id="main-content">', '</main>');
  if (!mainContent) return {};

  // Find the "Still Have Questions" section
  const shqStart = mainContent.indexOf('<!-- Still Have Questions');
  if (shqStart === -1) {
    // Try to find by section content pattern
    const altMatch = mainContent.match(/<section class="section section-gray" aria-label="[^"]*">\s*<div class="container">\s*<div class="info-card[^"]*"[^>]*>\s*<h2[^>]*>([^<]+)<\/h2>\s*<p>([^<]+)<\/p>/);
    if (altMatch) {
      return { shqTitle: altMatch[1].trim(), shqText: altMatch[2].trim() };
    }
    return {};
  }

  const shqSection = mainContent.substring(shqStart, mainContent.indexOf('</section>', shqStart) + '</section>'.length);
  const titleMatch = shqSection.match(/<h2[^>]*>([^<]+)<\/h2>/);
  const textMatch = shqSection.match(/<h2[^>]*>[^<]+<\/h2>\s*<p>([^<]+)<\/p>/);

  // Extract button labels
  const buttons = [];
  const btnRegex = /<a[^>]*class="btn btn-outline"[^>]*>([^<]+)<\/a>/g;
  let m;
  while ((m = btnRegex.exec(shqSection)) !== null) {
    buttons.push(m[1].trim());
  }

  return {
    shqTitle: titleMatch ? titleMatch[1].trim() : '',
    shqText: textMatch ? textMatch[1].trim() : '',
    shqButtons: buttons
  };
}

function extractCtaBanner(html) {
  const mainContent = extractBetween(html, '<main id="main-content">', '</main>');
  if (!mainContent) return {};

  const ctaStart = mainContent.indexOf('<!-- CTA Banner');
  let ctaSection;
  if (ctaStart !== -1) {
    ctaSection = mainContent.substring(ctaStart, mainContent.indexOf('</section>', ctaStart) + '</section>'.length);
  } else {
    // Try to find cta-banner class
    const altStart = mainContent.lastIndexOf('<div class="cta-banner');
    if (altStart === -1) return {};
    ctaSection = mainContent.substring(altStart, mainContent.indexOf('</section>', altStart) + '</section>'.length);
  }

  const titleMatch = ctaSection.match(/<h2>([^<]+)<\/h2>/);
  const textMatch = ctaSection.match(/<h2>[^<]+<\/h2>\s*<p>([^<]+)<\/p>/);
  const btnMatch = ctaSection.match(/data-booking>([^<]+)<\/a>/);
  const subtextMatch = ctaSection.match(/<p class="text-sm"[^>]*>([\s\S]*?)<\/p>/);

  return {
    ctaTitle: titleMatch ? titleMatch[1].trim() : '',
    ctaText: textMatch ? textMatch[1].trim() : '',
    ctaButton: btnMatch ? btnMatch[1].trim() : '',
    ctaSubtext: subtextMatch ? subtextMatch[1].trim() : ''
  };
}

function extractFooter(html) {
  const footerSection = extractBetween(html, '<footer class="footer"', '</footer>');
  if (!footerSection) return {};

  // Brand description
  const brandDescMatch = footerSection.match(/<div class="footer-brand">\s*(?:<div[^>]*>[\s\S]*?<\/div>|<a[^>]*>[\s\S]*?<\/a>)\s*<p>([^<]+)<\/p>/);
  const brandDescription = brandDescMatch ? brandDescMatch[1].trim() : '';

  // Quick Links heading
  const qlHeadingMatch = footerSection.match(/<h4>([^<]+)<\/h4>\s*<ul[^>]*>\s*<li>/);
  const quickLinksHeading = qlHeadingMatch ? qlHeadingMatch[1].trim() : '';

  // Quick Links items
  const quickLinks = [];
  // Find the first <ul> after "Quick Links" heading
  const qlSection = extractBetween(footerSection, quickLinksHeading + '</h4>', '</ul>');
  const qlRegex = /<li><a[^>]*>([^<]+)<\/a><\/li>/g;
  let m;
  while ((m = qlRegex.exec(qlSection)) !== null) {
    quickLinks.push(m[1].trim());
  }

  // Guides heading
  const guidesMatch = footerSection.match(/<h4>([^<]+)<\/h4>\s*<ul[^>]*>\s*<li><a href="[^"]*blog/);
  const guidesHeading = guidesMatch ? guidesMatch[1].trim() : '';

  // Guide link labels
  const guideLabels = [];
  if (guidesHeading) {
    const guidesSection = extractBetween(footerSection, guidesHeading + '</h4>', '</ul>');
    const glRegex = /<li><a[^>]*>([^<]+)<\/a><\/li>/g;
    while ((m = glRegex.exec(guidesSection)) !== null) {
      guideLabels.push(m[1].trim());
    }
  }

  // Park Info heading
  const parkInfoMatch = footerSection.match(/<h4>([^<]+)<\/h4>\s*<ul[^>]*>\s*(?:<li><a href="tel|<li>[^<]*(?:AM|PM|午前|시|часов|Uhr|Täglich|Quotidien|h |ежедневно|Harian|hàng|Mở|सुबह|ทุก|ນ))/i);
  const parkInfoHeading = parkInfoMatch ? parkInfoMatch[1].trim() : '';

  // Park Info items
  const parkInfoItems = [];
  if (parkInfoHeading) {
    const piSection = extractBetween(footerSection, parkInfoHeading + '</h4>', '</ul>');
    // Get both link and non-link items
    const piRegex = /<li>(?:<a[^>]*>([^<]+)<\/a>|([^<]+))<\/li>/g;
    while ((m = piRegex.exec(piSection)) !== null) {
      parkInfoItems.push((m[1] || m[2]).trim());
    }
  }

  // Affiliate disclosure
  const affiliateMatch = footerSection.match(/<strong>Affiliate Disclosure:<\/strong>\s*([\s\S]*?)<\/p>/);
  const affiliate = affiliateMatch ? affiliateMatch[1].trim() : '';

  // Disclaimer
  const disclaimerMatch = footerSection.match(/<strong>Disclaimer:<\/strong>\s*([\s\S]*?)<\/p>/);
  const disclaimer = disclaimerMatch ? disclaimerMatch[1].trim() : '';

  // Copyright
  const copyrightMatch = footerSection.match(/<div class="footer-bottom">\s*(?:<div class="container">\s*)?<p>([^<]+)<\/p>/);
  // Also try: &copy; pattern
  const altCopyright = footerSection.match(/(&copy;[^<]+)</);
  const copyright = copyrightMatch ? copyrightMatch[1].trim() : (altCopyright ? altCopyright[1].trim() : '');

  // Google Maps link text
  const mapsMatch = footerSection.match(/<a href="https:\/\/maps\.google\.com[^"]*"[^>]*>([^<]+)<\/a>/);
  const mapsLinkText = mapsMatch ? mapsMatch[1].trim() : '';

  // Hours text items
  const hoursItems = parkInfoItems.filter(item => !item.includes('+66') && !item.includes('Google') && !item.includes('Maps'));

  return {
    brandDescription,
    quickLinksHeading,
    quickLinks,
    guidesHeading,
    guideLabels,
    parkInfoHeading,
    mapsLinkText,
    hoursItems,
    affiliate,
    disclaimer,
    copyright
  };
}

function extractStickyBar(html) {
  const stickySection = extractBetween(html, '<div class="sticky-bar"', '</div>\n  </div>\n  </div>');
  if (!stickySection) {
    // Try alternate ending pattern
    const alt = extractBetween(html, '<div class="sticky-bar"', 'data-booking>');
    if (!alt) return {};
  }

  // Find all text content in sticky bar
  const fullSticky = (() => {
    const start = html.indexOf('<div class="sticky-bar"');
    if (start === -1) return '';
    // Find the closing tags - sticky bar is relatively short
    const end = html.indexOf('</div>\n\n', start);
    if (end === -1) return html.substring(start, start + 600);
    return html.substring(start, end + 10);
  })();

  // Extract "per person" text and save percentage
  const subTextMatch = fullSticky.match(/<div class="text-sm text-muted">([^<]+)<\/div>/);
  const subText = subTextMatch ? subTextMatch[1].trim() : '';

  // Or for Japanese style (no wrapper div)
  const altSubMatch = fullSticky.match(/<span class="sticky-bar-sub">([^<]+)<\/span>/);
  const altSubText = altSubMatch ? altSubMatch[1].trim() : '';

  // Book now button text
  const btnMatch = fullSticky.match(/data-booking>([^<]+)<\/a>/);
  const bookNow = btnMatch ? btnMatch[1].trim() : '';

  // Aria label
  const ariaMatch = fullSticky.match(/aria-label="([^"]+)"/);
  const ariaLabel = ariaMatch ? ariaMatch[1].trim() : '';

  return {
    subText: subText || altSubText,
    bookNow,
    ariaLabel
  };
}

function extractSkipLink(html) {
  const m = html.match(/<a href="#main-content" class="skip-link">([^<]+)<\/a>/);
  return m ? m[1].trim() : 'Skip to main content';
}

function extractForLang(langCode) {
  const faqPath = getFaqPath(langCode);
  if (!fs.existsSync(faqPath)) {
    console.log(`  Skipping ${langCode}: ${faqPath} not found`);
    return null;
  }

  const html = fs.readFileSync(faqPath, 'utf8');
  console.log(`  Processing ${langCode} (${faqPath})`);

  const nav = extractNavLabels(html);
  const announcement = extractAnnouncementBar(html);
  const hero = extractHeroSection(html);
  const jump = extractJumpLabels(html);
  const categories = extractFaqCategories(html);
  const shq = extractStillHaveQuestions(html);
  const cta = extractCtaBanner(html);
  const footer = extractFooter(html);
  const sticky = extractStickyBar(html);
  const skipLink = extractSkipLink(html);

  return {
    skipLink,
    nav,
    announcement,
    faq: {
      // SEO meta
      title: extractTitle(html),
      metaDescription: extractMeta(html, 'description'),
      metaKeywords: extractMeta(html, 'keywords'),
      ogTitle: extractMeta(html, 'og:title'),
      ogDescription: extractMeta(html, 'og:description'),
      twitterTitle: extractMeta(html, 'twitter:title'),
      twitterDescription: extractMeta(html, 'twitter:description'),

      // Hero
      breadcrumbHome: hero.breadcrumbHome,
      breadcrumbCurrent: hero.breadcrumbCurrent,
      heroTitle: hero.heroTitle,
      heroSubtitle: hero.heroSubtitle,
      heroText: hero.heroText,

      // Jump navigation
      jumpTitle: jump.jumpTitle,
      jumpLabels: jump.jumpLabels,

      // FAQ categories and questions
      categories,

      // Still Have Questions
      ...shq,

      // CTA Banner
      ...cta
    },
    stickyBar: sticky,
    footer
  };
}

// Main
console.log('=== Extracting i18n from FAQ pages ===\n');

const langs = SITE.languages.map(l => l.code);
for (const lang of langs) {
  const data = extractForLang(lang);
  if (!data) continue;

  const outPath = path.join(__dirname, 'i18n', `${lang}.json`);
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`  -> Wrote ${outPath}\n`);
}

console.log('=== Done ===');
