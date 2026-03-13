#!/usr/bin/env node

/**
 * Site Updater
 *
 * Reads data/prices.json and updates all website files:
 * - js/main.js: CURRENCY_RATES object
 * - tickets.html: pricing table, cards, sticky bar, meta tags
 * - index.html + all language versions: pricing cards, sticky bar
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PRICES_FILE = path.join(ROOT, 'data', 'prices.json');

// All files that contain data-price-thb attributes
const PRICE_ATTR_FILES = [
  'tickets.html',
  'index.html',
  'de/index.html',
  'fr/index.html',
  'hi/index.html',
  'ja/index.html',
  'ko/index.html',
  'lo/index.html',
  'ms/index.html',
  'ru/index.html',
  'vi/index.html',
  'zh-CN/index.html',
  'zh-TW/index.html'
];

function loadPrices() {
  return JSON.parse(fs.readFileSync(PRICES_FILE, 'utf8'));
}

function getPackagePrice(packages, id) {
  const pkg = packages.find(p => p.id === id);
  return pkg ? pkg.priceTHB : null;
}

function getPackageGatePrice(packages, id) {
  const pkg = packages.find(p => p.id === id);
  return pkg ? pkg.gatePrice : null;
}

function formatNumber(n) {
  return n.toLocaleString('en-US');
}

// ============================================================
// 1. Update js/main.js CURRENCY_RATES
// ============================================================
function updateMainJs(exchangeRates) {
  const filePath = path.join(ROOT, 'js', 'main.js');
  let content = fs.readFileSync(filePath, 'utf8');

  // Build replacement CURRENCY_RATES block
  const entries = Object.entries(exchangeRates).map(([code, info]) => {
    return `    ${code}: { rate: ${info.rate}, symbol: '${info.symbol}', code: '${code}', decimals: ${info.decimals} }`;
  });

  const newBlock = `const CURRENCY_RATES = {\n${entries.join(',\n')}\n  };`;

  // Replace the existing CURRENCY_RATES object
  // Note: must escape $ in replacement string ($ is special in String.replace)
  const safeBlock = newBlock.replace(/\$/g, '$$$$');
  const replaced = content.replace(
    /const CURRENCY_RATES = \{[\s\S]*?\};/,
    safeBlock
  );

  if (replaced === content) {
    console.log('  CURRENCY_RATES in main.js already up to date (no changes)');
    return true;
  }

  fs.writeFileSync(filePath, replaced);
  console.log('  Updated js/main.js CURRENCY_RATES');
  return true;
}

// ============================================================
// 2. Update data-price-thb attributes across all HTML files
// ============================================================
function updatePriceAttributes(filePath, packages) {
  const fullPath = path.join(ROOT, filePath);
  let content = fs.readFileSync(fullPath, 'utf8');
  let changed = false;

  const onlinePrice = getPackagePrice(packages, 'standard-admission');
  const gatePrice = getPackageGatePrice(packages, 'standard-admission');
  const vipPrice = getPackagePrice(packages, 'vip-cabana-deluxe');

  // The pricing cards have 3 data-price-thb values in order:
  // 1st: gate price (1595), 2nd: online price (870), 3rd: VIP price (2500)
  //
  // Strategy: Find all data-price-thb="..." and update based on context.
  // We use the surrounding HTML to identify which price each is.

  // Update gate price card (first pricing-amount)
  if (gatePrice) {
    // Match the gate price card - it's the first data-price-thb in a pricing-card
    const gatePattern = /(<div class="pricing-card">\s*<h3>[^<]*<\/h3>\s*<div[^>]*data-price-thb=")(\d+)(")/;
    const gateMatch = content.match(gatePattern);
    if (gateMatch && gateMatch[2] !== String(gatePrice)) {
      content = content.replace(gatePattern, `$1${gatePrice}$3`);
      changed = true;
    }
  }

  // Broader approach: replace all data-price-thb values based on known prices
  // For files that have the 3-card pattern, update them positionally
  const priceAttrRegex = /data-price-thb="(\d+)"/g;
  let match;
  const positions = [];
  while ((match = priceAttrRegex.exec(content)) !== null) {
    positions.push({ index: match.index, value: parseInt(match[1], 10), full: match[0] });
  }

  if (positions.length >= 3) {
    // Typical pattern: [gatePrice, onlinePrice, vipPrice, ...stickyBar]
    // Identify by checking surrounding context
    const newContent = content.replace(/data-price-thb="(\d+)"/g, (fullMatch, oldVal) => {
      const val = parseInt(oldVal, 10);

      // Sticky bar always has online price
      // Check what follows this attribute for context clues
      const idx = content.indexOf(fullMatch);
      const before = content.substring(Math.max(0, idx - 200), idx);

      // Sticky bar context
      if (before.includes('sticky-bar-price')) {
        if (onlinePrice && val !== onlinePrice) {
          changed = true;
          return `data-price-thb="${onlinePrice}"`;
        }
        return fullMatch;
      }

      // Gate price card context (pricing-card without "featured")
      if (before.includes('pricing-card') && !before.includes('featured') && !before.includes('VIP') && !before.includes('vip') && !before.includes('Cabana') && !before.includes('cabana')) {
        // Check if this is the first card (gate price)
        const lastCardStart = before.lastIndexOf('pricing-card');
        const afterCard = before.substring(lastCardStart);
        if (!afterCard.includes('featured')) {
          if (gatePrice && val !== gatePrice) {
            changed = true;
            return `data-price-thb="${gatePrice}"`;
          }
        }
      }

      return fullMatch;
    });
    content = newContent;
  }

  // Update data-price-thb and data-price-original-thb based on context
  // Use a smarter approach: identify pricing cards by their structure
  if (onlinePrice) {
    const old = content;
    // Featured card (online price) and sticky bar — update any stale value
    content = content.replace(
      /(pricing-card featured[\s\S]*?data-price-thb=")(\d+)(")/,
      `$1${onlinePrice}$3`
    );
    content = content.replace(
      /(sticky-bar-price[^>]*data-price-thb=")(\d+)(")/g,
      `$1${onlinePrice}$3`
    );
    if (content !== old) changed = true;
  }

  if (gatePrice) {
    const old = content;
    // Gate price card (non-featured, non-VIP)
    content = content.replace(
      /(pricing-card">\s*<h3>[^<]*(?:Gate|Walk)[^<]*<\/h3>\s*<div[^>]*data-price-thb=")(\d+)(")/,
      `$1${gatePrice}$3`
    );
    // Original price in sticky bar
    content = content.replace(
      /(data-price-original-thb=")(\d+)(")/g,
      `$1${gatePrice}$3`
    );
    if (content !== old) changed = true;
  }

  // Fix broken truncated values (data-price-thb="1" or "2") in some language files
  if (gatePrice) {
    const old = content;
    content = content.replace(
      /(pricing-amount[^>]*data-price-thb=")([1-9])(")/g,
      (match, pre, val, post) => {
        const v = parseInt(val, 10);
        if (v <= 2) return `${pre}${v === 1 ? gatePrice : (vipPrice || v)}${post}`;
        return match;
      }
    );
    if (content !== old) changed = true;
  }

  // Also update visible fallback text inside pricing-amount divs
  // Pattern: data-price-thb="1171">\n  <span class="pricing-currency">THB</span>870
  // Should become: ...>THB</span>1,171
  const fallbackPattern = /(data-price-thb="(\d+)">\s*<span class="pricing-currency">THB<\/span>)([\d,]+)/g;
  const beforeFallback = content;
  content = content.replace(fallbackPattern, (match, prefix, thbValue, visibleText) => {
    const formatted = formatNumber(parseInt(thbValue, 10));
    if (visibleText !== formatted) {
      return `${prefix}${formatted}`;
    }
    return match;
  });
  if (content !== beforeFallback) changed = true;

  // Update sticky bar visible text: THB X,XXX <small>THB Y,YYY</small>
  if (onlinePrice) {
    const stickyPattern = /(sticky-bar-price[^>]*>\s*)THB [\d,]+(\s*<small>)/g;
    const beforeSticky = content;
    content = content.replace(stickyPattern, `$1THB ${formatNumber(onlinePrice)}$2`);
    if (content !== beforeSticky) changed = true;
  }

  if (changed) {
    fs.writeFileSync(fullPath, content);
    console.log(`  Updated ${filePath}`);
  } else {
    console.log(`  No changes needed: ${filePath}`);
  }

  return changed;
}

// ============================================================
// 3. Update tickets.html comparison table and text
// ============================================================
function updateTicketsTable(packages) {
  const filePath = path.join(ROOT, 'tickets.html');
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  // Extract current prices from the HTML to build old->new mapping
  // This avoids hardcoding old values that become stale after first update
  const currentOnlineAttr = content.match(/data-price-thb="(\d+)"[^>]*>\s*<span class="pricing-currency">THB<\/span>([\d,]+)/);

  for (const pkg of packages) {
    if (!pkg.priceTHB) continue;
    const newFormatted = `THB ${formatNumber(pkg.priceTHB)}`;

    // Update gate price references (THB X,XXX in table cells and prose)
    if (pkg.gatePrice) {
      const newGateFormatted = `THB ${formatNumber(pkg.gatePrice)}`;
      // Gate price doesn't change often, but keep consistent
    }
  }

  // Update all THB price references in the comparison table
  // Strategy: find table cells with <strong>THB X,XXX</strong> and update based on data-price-thb
  const tablePricePattern = /data-price-thb="(\d+)"[^>]*>[\s\S]*?<strong>THB ([\d,]+)<\/strong>/g;
  const beforeTable = content;
  content = content.replace(tablePricePattern, (match, attrVal, visibleVal) => {
    const expected = formatNumber(parseInt(attrVal, 10));
    if (visibleVal !== expected) {
      return match.replace(`THB ${visibleVal}`, `THB ${expected}`);
    }
    return match;
  });
  if (content !== beforeTable) changed = true;

  // Update savings percentage
  const standardOnline = getPackagePrice(packages, 'standard-admission');
  const standardGate = getPackageGatePrice(packages, 'standard-admission');
  if (standardOnline && standardGate) {
    const newSavings = Math.round((1 - standardOnline / standardGate) * 100);
    const old = content;
    content = content.replace(/Save (\d+)%/g, `Save ${newSavings}%`);
    content = content.replace(/save up to (\d+)%/g, `save up to ${newSavings}%`);
    content = content.replace(/save (\d+)%/g, `save ${newSavings}%`);
    if (content !== old) changed = true;
  }

  // Update USD approximations
  const usdRate = null; // Will be calculated below
  // We need exchange rates for this
  const priceData = loadPrices();
  const usdInfo = priceData.exchangeRates?.USD;
  if (usdInfo && usdInfo.rate) {
    const rate = usdInfo.rate;

    // ~$44 USD (gate price)
    if (standardGate) {
      const newUsd = Math.round(standardGate * rate);
      const old = content;
      content = content.replace(/~\$\d+ USD per person\b(?!.*Save)/g, `~$${newUsd} USD per person`);
      // Also in meta tags and list items for gate price
      content = content.replace(
        /\(~\$\d+ USD\)(?=\s*<\/li>|\))/g,
        (match, offset) => {
          const before = content.substring(Math.max(0, offset - 100), offset);
          if (before.includes('Gate price') || before.includes('gate price') || before.includes('1,595') || before.includes(formatNumber(standardGate))) {
            return `(~$${newUsd} USD)`;
          }
          if (before.includes('Online price') || before.includes('online price') || before.includes('870') || before.includes(formatNumber(standardOnline))) {
            const onlineUsd = Math.round(standardOnline * rate);
            return `(~$${onlineUsd} USD)`;
          }
          return match;
        }
      );
      if (content !== old) changed = true;
    }

    // ~$24 USD (online price)
    if (standardOnline) {
      const newOnlineUsd = Math.round(standardOnline * rate);
      const old = content;
      // The "~$24 USD per person — Save XX%" pattern
      content = content.replace(
        /~\$\d+ USD per person &mdash; Save/g,
        `~$${newOnlineUsd} USD per person &mdash; Save`
      );
      if (content !== old) changed = true;
    }

    // ~$69 USD (VIP starting price)
    const vipPrice = getPackagePrice(packages, 'vip-cabana-deluxe');
    if (vipPrice) {
      const newVipUsd = Math.round(vipPrice * rate);
      const old = content;
      content = content.replace(
        /~\$\d+ USD &mdash; Starting price/g,
        `~$${newVipUsd} USD &mdash; Starting price`
      );
      if (content !== old) changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(filePath, content);
    console.log('  Updated tickets.html table and text');
  }

  return changed;
}

// ============================================================
// 4. Update index.html USD approximations and savings %
// ============================================================
function updateIndexText(filePath, packages, exchangeRates) {
  const fullPath = path.join(ROOT, filePath);
  let content = fs.readFileSync(fullPath, 'utf8');
  let changed = false;

  const standardOnline = getPackagePrice(packages, 'standard-admission');
  const standardGate = getPackageGatePrice(packages, 'standard-admission');
  const vipPrice = getPackagePrice(packages, 'vip-cabana-deluxe');

  // Update savings %
  if (standardOnline && standardGate) {
    const newSavings = Math.round((1 - standardOnline / standardGate) * 100);
    const old = content;
    content = content.replace(/Save (\d+)%/g, `Save ${newSavings}%`);
    content = content.replace(/save up to (\d+)%/g, `save up to ${newSavings}%`);
    content = content.replace(/saving you up to (\d+)%/g, `saving you up to ${newSavings}%`);
    if (content !== old) changed = true;
  }

  // Update USD approximations (only in English index.html)
  if (filePath === 'index.html' && exchangeRates?.USD) {
    const rate = exchangeRates.USD.rate;

    if (standardGate) {
      const gateUsd = Math.round(standardGate * rate);
      const old = content;
      content = content.replace(/~\$\d+ USD per person(?!.*Save)/g, `~$${gateUsd} USD per person`);
      content = content.replace(
        /\(~\$\d+ USD\)/g,
        (match, offset) => {
          const before = content.substring(Math.max(0, offset - 150), offset);
          if (before.includes('1,595') || before.includes('Gate') || before.includes('gate')) {
            return `(~$${gateUsd} USD)`;
          }
          if (before.includes('870') || before.includes('Online') || before.includes('online')) {
            return `(~$${Math.round(standardOnline * rate)} USD)`;
          }
          return match;
        }
      );
      if (content !== old) changed = true;
    }

    if (standardOnline) {
      const onlineUsd = Math.round(standardOnline * rate);
      const old = content;
      content = content.replace(
        /~\$\d+ USD per person &mdash; Save/g,
        `~$${onlineUsd} USD per person &mdash; Save`
      );
      content = content.replace(
        /\(~\$\d+ USD\), saving/g,
        `(~$${onlineUsd} USD), saving`
      );
      if (content !== old) changed = true;
    }

    if (vipPrice) {
      const vipUsd = Math.round(vipPrice * rate);
      const old = content;
      content = content.replace(
        /~\$\d+ USD &mdash; Starting price/g,
        `~$${vipUsd} USD &mdash; Starting price`
      );
      if (content !== old) changed = true;
    }

    // Update THB prices in prose — use dynamic pattern to match any old value
    if (standardGate) {
      const old = content;
      // Gate price references like "THB 1,595" in structured data and prose
      content = content.replace(/gate price THB [\d,]+/g, `gate price THB ${formatNumber(standardGate)}`);
      content = content.replace(/gate price is <strong>THB [\d,]+<\/strong>/g, `gate price is <strong>THB ${formatNumber(standardGate)}</strong>`);
      if (content !== old) changed = true;
    }
    if (standardOnline) {
      const old = content;
      // Online price references like "THB 870" or "THB 1,171" in structured data
      content = content.replace(/From THB [\d,]+ online/g, `From THB ${formatNumber(standardOnline)} online`);
      content = content.replace(/from THB [\d,]+ online/g, `from THB ${formatNumber(standardOnline)} online`);
      content = content.replace(/from just THB [\d,]+ online/g, `from just THB ${formatNumber(standardOnline)} online`);
      content = content.replace(/start from just THB [\d,]+/g, `start from just THB ${formatNumber(standardOnline)}`);
      content = content.replace(/start from THB [\d,]+/g, `start from THB ${formatNumber(standardOnline)}`);
      content = content.replace(/price from THB [\d,]+!/g, `price from THB ${formatNumber(standardOnline)}!`);
      if (content !== old) changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(fullPath, content);
    console.log(`  Updated ${filePath} text/savings`);
  }

  return changed;
}

// ============================================================
// 5. Update meta tags in tickets.html
// ============================================================
function updateMetaTags(packages, exchangeRates) {
  const filePath = path.join(ROOT, 'tickets.html');
  let content = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  const standardOnline = getPackagePrice(packages, 'standard-admission');
  const standardGate = getPackageGatePrice(packages, 'standard-admission');

  if (standardOnline && standardGate && exchangeRates?.USD) {
    const savings = Math.round((1 - standardOnline / standardGate) * 100);

    // Update meta description patterns
    const old = content;
    content = content.replace(
      /THB \d[\d,]* online \(gate price THB \d[\d,]*\)\. Save \d+%/g,
      `THB ${formatNumber(standardOnline)} online (gate price THB ${formatNumber(standardGate)}). Save ${savings}%`
    );
    if (content !== old) changed = true;
  }

  if (changed) {
    fs.writeFileSync(filePath, content);
    console.log('  Updated tickets.html meta tags');
  }

  return changed;
}

// ============================================================
// Main
// ============================================================
function main() {
  console.log('=== Site Updater ===\n');

  const priceData = loadPrices();
  const { packages, exchangeRates } = priceData;

  console.log('Current prices:');
  for (const pkg of packages) {
    console.log(`  ${pkg.name}: ฿${formatNumber(pkg.priceTHB)}${pkg.gatePrice ? ` (gate: ฿${formatNumber(pkg.gatePrice)})` : ''}`);
  }
  console.log('');

  // 1. Update main.js exchange rates
  console.log('Updating exchange rates...');
  updateMainJs(exchangeRates);

  // 2. Update data-price-thb attributes in all HTML files
  console.log('\nUpdating price attributes...');
  for (const file of PRICE_ATTR_FILES) {
    updatePriceAttributes(file, packages);
  }

  // 3. Update tickets.html table and text
  console.log('\nUpdating tickets.html details...');
  updateTicketsTable(packages);
  updateMetaTags(packages, exchangeRates);

  // 4. Update index.html text (English only has USD approximations)
  console.log('\nUpdating index pages...');
  updateIndexText('index.html', packages, exchangeRates);

  // Note: localized pages have their own currency approximations (EUR, JPY, etc.)
  // We don't update those as they are manually localized

  console.log('\n=== Site update complete ===');
}

main();
