#!/usr/bin/env node

/**
 * Klook Price Scraper for Aquaverse (Activity ID: 85772)
 *
 * Loads the Klook activity page once in THB, extracts package names + prices.
 * Saves results to data/prices.json and appends to data/prices-history.json.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ACTIVITY_URL = 'https://www.klook.com/activity/85772-columbia-pictures-aquaverse?currency=THB';
const DATA_DIR = path.join(__dirname, '..', 'data');
const PRICES_FILE = path.join(DATA_DIR, 'prices.json');
const HISTORY_FILE = path.join(DATA_DIR, 'prices-history.json');
const SCREENSHOT_FILE = path.join(__dirname, '..', 'debug-screenshot.png');
const MAX_RETRIES = parseInt(process.env.SCRAPE_RETRIES || '3', 10);
const MAX_HISTORY_DAYS = 365;

// Package matchers: map Klook package names to our internal IDs
const PACKAGE_MATCHERS = [
  {
    id: 'standard-admission',
    patterns: [/standard/i, /general\s*admission/i, /water\s*park\s*(?:ticket|admission|entry)/i],
    fallbackOrder: 0
  },
  {
    id: 'admission-locker',
    patterns: [/locker/i, /admission\s*\+?\s*locker/i],
    fallbackOrder: 1
  },
  {
    id: 'admission-onsen',
    patterns: [/onsen/i, /steam/i, /spa/i, /admission\s*\+?\s*onsen/i],
    fallbackOrder: 2
  },
  {
    id: 'vip-cabana-deluxe',
    patterns: [/cabana\s*deluxe/i, /vip\s*deluxe/i, /deluxe\s*cabana/i],
    fallbackOrder: 3
  },
  {
    id: 'vip-cabana-super',
    patterns: [/cabana\s*super/i, /vip\s*super/i, /super\s*cabana/i],
    fallbackOrder: 4
  },
  {
    id: 'vip-cabana-ultimate',
    patterns: [/cabana\s*ultimate/i, /vip\s*ultimate/i, /ultimate\s*cabana/i],
    fallbackOrder: 5
  }
];

function matchPackage(name) {
  const normalized = name.trim();
  for (const matcher of PACKAGE_MATCHERS) {
    for (const pattern of matcher.patterns) {
      if (pattern.test(normalized)) {
        return matcher.id;
      }
    }
  }
  return null;
}

function validatePrice(price) {
  return typeof price === 'number' && price >= 100 && price <= 50000;
}

async function scrapeKlookPrices() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled'
    ]
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
    locale: 'en-US',
    timezoneId: 'Asia/Bangkok',
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9,th;q=0.8'
    }
  });

  const page = await context.newPage();

  // Remove webdriver flag
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  console.log('Navigating to Klook activity page...');
  await page.goto(ACTIVITY_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 30000
  });

  // Wait for page to settle
  await page.waitForTimeout(3000);

  // Handle cookie consent if it appears
  try {
    const cookieBtn = page.locator('button:has-text("Accept"), button:has-text("OK"), button:has-text("Got it")').first();
    if (await cookieBtn.isVisible({ timeout: 3000 })) {
      await cookieBtn.click();
      console.log('Accepted cookie consent');
      await page.waitForTimeout(1000);
    }
  } catch {
    // No cookie banner, continue
  }

  // Scroll down to trigger lazy-loading of package section
  console.log('Scrolling to load packages...');
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollBy(0, 600));
    await page.waitForTimeout(800);
  }

  // Wait for package/price elements to appear
  console.log('Waiting for price elements...');
  try {
    await page.waitForSelector('[class*="rice"], [class*="ackage"], [data-testid*="package"]', {
      timeout: 15000
    });
  } catch {
    console.log('Warning: could not find price/package selectors, trying extraction anyway...');
  }

  // Extra wait for dynamic content
  await page.waitForTimeout(2000);

  // Extract packages using multiple strategies
  console.log('Extracting package data...');
  const packages = await page.evaluate(() => {
    const results = [];
    const seen = new Set();

    // Strategy 1: Look for package option cards/sections
    const strategies = [
      // Common Klook selectors for package cards
      '[class*="PackageOption"], [class*="package-option"], [class*="packageOption"]',
      '[class*="ActivityPackage"], [class*="activity-package"]',
      '[class*="OptionCard"], [class*="option-card"]',
      '[data-testid*="package"], [data-testid*="option"]',
      // Package list items
      '[class*="PackageList"] > div, [class*="package-list"] > div',
      // Broader: any card-like element with a price
      '[class*="card"][class*="ackage"], [class*="Card"][class*="ackage"]'
    ];

    for (const selector of strategies) {
      const cards = document.querySelectorAll(selector);
      cards.forEach(card => {
        // Try to find title
        const titleEl = card.querySelector(
          '[class*="title"], [class*="Title"], [class*="name"], [class*="Name"], h3, h4, h5'
        );
        const name = titleEl?.textContent?.trim();
        if (!name || seen.has(name)) return;

        // Try to find price
        const priceEls = card.querySelectorAll(
          '[class*="price"], [class*="Price"], [class*="selling"], [class*="Selling"], [class*="amount"], [class*="Amount"]'
        );
        let price = null;
        for (const el of priceEls) {
          const text = el.textContent.replace(/[,\s]/g, '');
          const match = text.match(/[\d,]+(?:\.\d+)?/);
          if (match) {
            const parsed = parseFloat(match[0].replace(/,/g, ''));
            if (parsed >= 100 && parsed <= 50000) {
              price = parsed;
              break;
            }
          }
        }

        if (name && price) {
          seen.add(name);
          results.push({ name, priceTHB: price });
        }
      });

      if (results.length >= 2) break;
    }

    // Strategy 2 (fallback): Scan all elements with price-like classes
    if (results.length < 2) {
      const allPriceEls = document.querySelectorAll(
        '[class*="rice"]:not(script):not(style)'
      );
      // Group prices with their nearest heading/label
      allPriceEls.forEach(el => {
        const parent = el.closest('[class*="ard"], [class*="ption"], [class*="ackage"], [class*="ow"], li');
        if (!parent) return;
        const heading = parent.querySelector('h3, h4, h5, [class*="title"], [class*="Title"], [class*="name"]');
        const name = heading?.textContent?.trim();
        if (!name || seen.has(name)) return;
        const text = el.textContent.replace(/[,\s]/g, '');
        const match = text.match(/[\d,]+(?:\.\d+)?/);
        if (match) {
          const parsed = parseFloat(match[0].replace(/,/g, ''));
          if (parsed >= 100 && parsed <= 50000) {
            seen.add(name);
            results.push({ name, priceTHB: parsed });
          }
        }
      });
    }

    return results;
  });

  // Take screenshot for debugging if few/no packages found
  if (packages.length < 2) {
    console.log(`Only found ${packages.length} packages. Taking debug screenshot...`);
    await page.screenshot({ path: 'debug-screenshot.png', fullPage: true });
  }

  await browser.close();
  return packages;
}

function mapScrapedToPackages(scraped, existingPackages) {
  const mapped = {};

  // First pass: match scraped packages to our IDs
  for (const item of scraped) {
    const id = matchPackage(item.name);
    if (id && validatePrice(item.priceTHB)) {
      mapped[id] = item.priceTHB;
      console.log(`  Matched: "${item.name}" → ${id} = ฿${item.priceTHB}`);
    } else if (id) {
      console.log(`  Rejected (invalid price): "${item.name}" = ${item.priceTHB}`);
    } else {
      console.log(`  Unmatched: "${item.name}" = ฿${item.priceTHB}`);
    }
  }

  // Merge with existing packages (keep old price if no new data)
  return existingPackages.map(pkg => {
    if (mapped[pkg.id] !== undefined) {
      const oldPrice = pkg.priceTHB;
      const newPrice = mapped[pkg.id];
      const changePercent = Math.abs((newPrice - oldPrice) / oldPrice * 100);

      if (changePercent > 50) {
        console.log(`  WARNING: ${pkg.id} price changed by ${changePercent.toFixed(1)}% (${oldPrice} → ${newPrice})`);
      }

      return { ...pkg, priceTHB: newPrice };
    }
    console.log(`  Keeping existing price for ${pkg.id}: ฿${pkg.priceTHB}`);
    return pkg;
  });
}

function updateHistory(history, packages, rates) {
  const today = new Date().toISOString().split('T')[0];

  // Build today's entry
  const priceMap = {};
  for (const pkg of packages) {
    priceMap[pkg.id] = pkg.priceTHB;
  }

  const rateMap = {};
  if (rates) {
    for (const [code, info] of Object.entries(rates)) {
      if (code !== 'THB') rateMap[code] = info.rate;
    }
  }

  const entry = {
    date: today,
    packages: priceMap,
    exchangeRates: rateMap
  };

  // Remove duplicate for today if re-running
  const filtered = history.filter(h => h.date !== today);
  filtered.push(entry);

  // Keep only last N days
  if (filtered.length > MAX_HISTORY_DAYS) {
    filtered.splice(0, filtered.length - MAX_HISTORY_DAYS);
  }

  return filtered;
}

async function main() {
  console.log('=== Klook Price Scraper ===');
  console.log(`Target: ${ACTIVITY_URL}`);
  console.log(`Retries: ${MAX_RETRIES}`);
  console.log('');

  // Load existing data
  let existingData;
  try {
    existingData = JSON.parse(fs.readFileSync(PRICES_FILE, 'utf8'));
  } catch {
    console.error('Could not read existing prices.json. Exiting.');
    process.exit(1);
  }

  let history;
  try {
    history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch {
    history = [];
  }

  // Scrape with retries
  let scraped = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`\nAttempt ${attempt}/${MAX_RETRIES}...`);
      scraped = await scrapeKlookPrices();
      console.log(`Found ${scraped.length} packages:`);
      scraped.forEach(p => console.log(`  - ${p.name}: ฿${p.priceTHB}`));

      if (scraped.length >= 2) break;

      console.log('Too few packages found, retrying...');
      scraped = null;
    } catch (err) {
      console.error(`Attempt ${attempt} failed: ${err.message}`);
    }

    if (attempt < MAX_RETRIES) {
      const delay = attempt * 5000;
      console.log(`Waiting ${delay / 1000}s before retry...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  if (!scraped || scraped.length < 2) {
    console.log('\nAll retries exhausted or insufficient packages found.');
    console.log('Keeping existing prices unchanged.');

    // Still update history with existing data
    history = updateHistory(history, existingData.packages, existingData.exchangeRates);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2) + '\n');

    process.exit(0);
  }

  // Map scraped data to our package structure
  console.log('\nMapping scraped packages...');
  const updatedPackages = mapScrapedToPackages(scraped, existingData.packages);

  // Update prices.json (keep existing exchange rates for now; fetch-rates.js updates them separately)
  existingData.lastUpdated = new Date().toISOString();
  existingData.packages = updatedPackages;
  fs.writeFileSync(PRICES_FILE, JSON.stringify(existingData, null, 2) + '\n');
  console.log('\nUpdated data/prices.json');

  // Update history
  history = updateHistory(history, updatedPackages, existingData.exchangeRates);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2) + '\n');
  console.log('Updated data/prices-history.json');

  console.log('\n=== Scraping complete ===');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
