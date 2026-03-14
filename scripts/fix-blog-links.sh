#!/bin/bash
# fix-blog-links.sh
# Task 1: Fix EN blog language selectors to point to translated blog articles
# Task 2: Add hreflang tags to ALL blog articles (EN + 11 languages = 108 files)

set -euo pipefail

BASE_DIR="/Volumes/T7/aquaverse"
BASE_URL="https://aquaverse-park.com"
LANGS=("zh-CN" "zh-TW" "ja" "ko" "ru" "hi" "ms" "vi" "de" "fr" "lo")
ARTICLES=(
  "aquaverse-ticket-prices.html"
  "aquaverse-review.html"
  "aquaverse-vs-ramayana.html"
  "aquaverse-with-kids.html"
  "aquaverse-food-guide.html"
  "how-to-get-to-aquaverse-from-bangkok.html"
  "best-hotels-near-aquaverse.html"
  "pattaya-itinerary-aquaverse.html"
  "index.html"
)

echo "============================================="
echo "  Task 1: Fix EN blog language selectors"
echo "============================================="

for article in "${ARTICLES[@]}"; do
  file="$BASE_DIR/blog/$article"
  if [ ! -f "$file" ]; then
    echo "WARNING: $file not found, skipping"
    continue
  fi

  echo "Fixing: blog/$article"

  if [ "$article" = "index.html" ]; then
    # For index.html: EN -> /blog/, others -> /{lang}/blog/
    sed -i '' 's|<a href="/" lang="en" role="option">English</a>|<a href="/blog/" lang="en" role="option" class="active" aria-selected="true">English</a>|' "$file"
    for lang in "${LANGS[@]}"; do
      sed -i '' "s|<a href=\"/${lang}/\" lang=\"${lang}\" role=\"option\">|<a href=\"/${lang}/blog/\" lang=\"${lang}\" role=\"option\">|" "$file"
    done
  else
    # For article files: EN -> /blog/{article}, others -> /{lang}/blog/{article}
    sed -i '' "s|<a href=\"/\" lang=\"en\" role=\"option\">English</a>|<a href=\"/blog/${article}\" lang=\"en\" role=\"option\" class=\"active\" aria-selected=\"true\">English</a>|" "$file"
    for lang in "${LANGS[@]}"; do
      sed -i '' "s|<a href=\"/${lang}/\" lang=\"${lang}\" role=\"option\">|<a href=\"/${lang}/blog/${article}\" lang=\"${lang}\" role=\"option\">|" "$file"
    done
  fi
done

echo ""
echo "============================================="
echo "  Task 2: Add hreflang tags to ALL blog files"
echo "============================================="

# Function to insert hreflang tags before </head> using awk
insert_hreflang() {
  local file="$1"
  local article="$2"
  local tmpfile="${file}.tmp"

  # Check if hreflang tags already exist
  if grep -q 'hreflang=' "$file" 2>/dev/null; then
    echo "SKIP (hreflang exists): $file"
    return
  fi

  if [ "$article" = "index.html" ]; then
    awk -v base="$BASE_URL" '
    /<\/head>/ {
      print "  <link rel=\"alternate\" hreflang=\"en\" href=\"" base "/blog/\" />"
      print "  <link rel=\"alternate\" hreflang=\"zh-TW\" href=\"" base "/zh-TW/blog/\" />"
      print "  <link rel=\"alternate\" hreflang=\"zh-CN\" href=\"" base "/zh-CN/blog/\" />"
      print "  <link rel=\"alternate\" hreflang=\"ja\" href=\"" base "/ja/blog/\" />"
      print "  <link rel=\"alternate\" hreflang=\"ko\" href=\"" base "/ko/blog/\" />"
      print "  <link rel=\"alternate\" hreflang=\"de\" href=\"" base "/de/blog/\" />"
      print "  <link rel=\"alternate\" hreflang=\"fr\" href=\"" base "/fr/blog/\" />"
      print "  <link rel=\"alternate\" hreflang=\"hi\" href=\"" base "/hi/blog/\" />"
      print "  <link rel=\"alternate\" hreflang=\"ru\" href=\"" base "/ru/blog/\" />"
      print "  <link rel=\"alternate\" hreflang=\"vi\" href=\"" base "/vi/blog/\" />"
      print "  <link rel=\"alternate\" hreflang=\"ms\" href=\"" base "/ms/blog/\" />"
      print "  <link rel=\"alternate\" hreflang=\"lo\" href=\"" base "/lo/blog/\" />"
      print "  <link rel=\"alternate\" hreflang=\"x-default\" href=\"" base "/blog/\" />"
    }
    { print }
    ' "$file" > "$tmpfile" && mv "$tmpfile" "$file"
  else
    awk -v base="$BASE_URL" -v fname="$article" '
    /<\/head>/ {
      print "  <link rel=\"alternate\" hreflang=\"en\" href=\"" base "/blog/" fname "\" />"
      print "  <link rel=\"alternate\" hreflang=\"zh-TW\" href=\"" base "/zh-TW/blog/" fname "\" />"
      print "  <link rel=\"alternate\" hreflang=\"zh-CN\" href=\"" base "/zh-CN/blog/" fname "\" />"
      print "  <link rel=\"alternate\" hreflang=\"ja\" href=\"" base "/ja/blog/" fname "\" />"
      print "  <link rel=\"alternate\" hreflang=\"ko\" href=\"" base "/ko/blog/" fname "\" />"
      print "  <link rel=\"alternate\" hreflang=\"de\" href=\"" base "/de/blog/" fname "\" />"
      print "  <link rel=\"alternate\" hreflang=\"fr\" href=\"" base "/fr/blog/" fname "\" />"
      print "  <link rel=\"alternate\" hreflang=\"hi\" href=\"" base "/hi/blog/" fname "\" />"
      print "  <link rel=\"alternate\" hreflang=\"ru\" href=\"" base "/ru/blog/" fname "\" />"
      print "  <link rel=\"alternate\" hreflang=\"vi\" href=\"" base "/vi/blog/" fname "\" />"
      print "  <link rel=\"alternate\" hreflang=\"ms\" href=\"" base "/ms/blog/" fname "\" />"
      print "  <link rel=\"alternate\" hreflang=\"lo\" href=\"" base "/lo/blog/" fname "\" />"
      print "  <link rel=\"alternate\" hreflang=\"x-default\" href=\"" base "/blog/" fname "\" />"
    }
    { print }
    ' "$file" > "$tmpfile" && mv "$tmpfile" "$file"
  fi
}

# Process all articles across all languages (EN + 11 translated)
for article in "${ARTICLES[@]}"; do
  # Process EN blog file
  en_file="$BASE_DIR/blog/$article"
  if [ -f "$en_file" ]; then
    echo "Adding hreflang: blog/$article"
    insert_hreflang "$en_file" "$article"
  fi

  # Process translated blog files
  for lang in "${LANGS[@]}"; do
    lang_file="$BASE_DIR/$lang/blog/$article"
    if [ -f "$lang_file" ]; then
      echo "Adding hreflang: $lang/blog/$article"
      insert_hreflang "$lang_file" "$article"
    else
      echo "WARNING: $lang_file not found"
    fi
  done
done

echo ""
echo "============================================="
echo "  Done! Summary:"
echo "============================================="
echo "Task 1: Fixed language selectors in 9 EN blog files"
echo "Task 2: Added hreflang tags to blog files across 12 languages"
echo ""
