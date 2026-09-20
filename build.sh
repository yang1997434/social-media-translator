#!/bin/bash
# Package only what the browser needs. Never ships worker/ (contains .dev.vars locally) or tests.
set -euo pipefail
cd "$(dirname "$0")"
V=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
mkdir -p dist && rm -f "dist/x-reply-filter-$V.zip"
zip -q -r "dist/x-reply-filter-$V.zip" manifest.json background.js shared.js llm.js lang.js rules.js content.js content.css translator.js translator.css ui.css popup.html popup.js options.html options.js icons LICENSE
echo "dist/x-reply-filter-$V.zip"; unzip -l "dist/x-reply-filter-$V.zip" | tail -1
if unzip -p "dist/x-reply-filter-$V.zip" | grep -qE "sk-or-v1-|sk-[a-z]{20,}"; then echo "SECRET FOUND IN ZIP - aborting"; rm "dist/x-reply-filter-$V.zip"; exit 1; fi
echo "secret check: clean"
