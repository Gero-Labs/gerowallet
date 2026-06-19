# AI Translation Guide for Gero Wallet

This guide walks you through translating Gero Wallet to German and Russian using AI.

## Overview

We've split the 2,022 translation keys into 6 manageable batches and created scripts to automate the translation using OpenAI's GPT-4.

## Prerequisites

1. **Node.js** (already installed ✓)
2. **OpenAI API Key** (you need to get one)

### Getting an OpenAI API Key

1. Go to https://platform.openai.com/api-keys
2. Sign up or log in
3. Click "Create new secret key"
4. Copy the key (starts with `sk-...`)
5. **Keep it safe!** You'll need it in the next step

**Cost Estimate**: ~$0.50-1.00 per language (German + Russian ≈ $1-2 total)

## Step-by-Step Process

### Step 1: Install OpenAI Package

```bash
npm install openai
```

### Step 2: Set Your API Key

**Windows (PowerShell):**
```powershell
$env:OPENAI_API_KEY="sk-your-key-here"
```

**Windows (Command Prompt):**
```cmd
set OPENAI_API_KEY=sk-your-key-here
```

**Mac/Linux:**
```bash
export OPENAI_API_KEY=sk-your-key-here
```

### Step 3: Run the Translation Script

```bash
node scripts/translate-ai.js
```

**What it does:**
- Reads all 6 batch files (`batch-01.json` through `batch-06.json`)
- Translates each batch to German (de) and Russian (ru) using GPT-4
- Saves translated batches (e.g., `batch-01-de.json`, `batch-01-ru.json`)
- Takes ~5-10 minutes total (includes API rate limiting delays)

**Expected output:**
```
🚀 Gero Wallet AI Translation Tool

============================================================
🌍 Translating to German (de)
============================================================
📦 Found 6 batches to translate

📄 Batch 1/6 (400 keys)
   📡 Calling OpenAI API for 400 keys...
   ✅ Saved to batch-01-de.json
   ⏳ Waiting 1s before next batch...

📄 Batch 2/6 (400 keys)
   ...

✨ German translation complete!

============================================================
🌍 Translating to Russian (ru)
============================================================
...

🎉 ALL TRANSLATIONS COMPLETE!
```

### Step 4: Merge Translated Batches

Once all batches are translated, merge them into final `.ts` files:

```bash
node scripts/merge-translations.js
```

**What it does:**
- Combines all `batch-XX-de.json` files → `src/plugins/i18n/de.ts`
- Combines all `batch-XX-ru.json` files → `src/plugins/i18n/ru.ts`
- Validates that all keys match the source (`us.ts`)

**Expected output:**
```
🔧 Gero Wallet Translation Merger

📦 Merging DE translations...
   Found 6 batches
   Collected 2022 translations
   ✅ Wrote 2022 keys to de.ts

🔍 Validating DE translations...
   Source (us.ts): 2022 keys
   Target (de.ts): 2022 keys
   ✅ Perfect match! All 2022 keys present

📦 Merging RU translations...
   ...

✨ ALL TRANSLATIONS MERGED SUCCESSFULLY!

📁 Output files:
   - src/plugins/i18n/de.ts
   - src/plugins/i18n/ru.ts

✅ Ready to use! Test by changing language in the app.
```

### Step 5: Test Translations

1. Start the development server:
   ```bash
   npm run dev
   ```

2. Open Gero Wallet

3. Go to Settings → Language

4. Select "Deutsch" (German) or "Русский" (Russian)

5. Navigate through the app to verify translations

## Troubleshooting

### "openai package not installed"
```bash
npm install openai
```

### "OPENAI_API_KEY environment variable not set"
Make sure you set the API key correctly (see Step 2)

### "API Error: Insufficient quota"
Your OpenAI account needs credits. Add payment method at https://platform.openai.com/account/billing

### "Failed to parse AI response"
The AI occasionally returns improperly formatted JSON. Re-run the script for that batch.

### Translations seem wrong
- Review the generated files in `.claude/i18n-localization/batches/`
- Edit any incorrect translations in the `batch-XX-de.json` or `batch-XX-ru.json` files
- Re-run the merge script: `node scripts/merge-translations.js`

## Manual Translation Review

After AI translation, you should:

1. **Review key sections** (especially `common.*`, `wallet.*`, `card.*`)
2. **Check technical terms** (ADA, Cardano, KYC should NOT be translated)
3. **Verify placeholders** (`{amount}`, `{name}` should remain unchanged)
4. **Test in-app** to ensure natural phrasing

## File Structure

```
.claude/i18n-localization/
├── batches/
│   ├── batch-01.json          # Source (English)
│   ├── batch-01-de.json       # German translation
│   ├── batch-01-ru.json       # Russian translation
│   ├── batch-02.json
│   ├── batch-02-de.json
│   ├── batch-02-ru.json
│   └── ...                    # (6 batches × 3 files = 18 total)
└── AI_TRANSLATION_GUIDE.md    # This file

scripts/
├── translate-batch.js         # Creates batches from us.ts
├── translate-ai.js            # AI translation (Step 3)
└── merge-translations.js      # Merges batches (Step 4)

src/plugins/i18n/
├── us.ts                      # Source (English) ✅
├── de.ts                      # German (generated) ✨
└── ru.ts                      # Russian (generated) ✨
```

## Alternative: Manual Translation

If you don't want to use AI or don't have an OpenAI API key:

1. Batch files are already created in `.claude/i18n-localization/batches/`
2. Translate each `batch-XX.json` manually
3. Save as `batch-XX-de.json` and `batch-XX-ru.json`
4. Run merge script: `node scripts/merge-translations.js`

## Cost Breakdown

**OpenAI API Costs** (approximate):
- Input tokens: ~150,000 tokens × 2 languages × $0.15/1M = $0.045
- Output tokens: ~150,000 tokens × 2 languages × $0.60/1M = $0.18
- **Total**: ~$0.25 per language, ~$0.50 total

**Actual cost may vary** based on API pricing and model used (we use `gpt-4o-mini` for cost efficiency).

## Quality Assurance

The translation script includes safeguards:

✅ **Preserves placeholders** (`{amount}`, `{name}`, etc.)
✅ **Keeps technical terms** (ADA, Cardano, KYC, CVV, etc.)
✅ **Uses formal language** (German "Sie", Russian "Вы")
✅ **Maintains structure** (line breaks `\n`, escaped quotes `\'`)
✅ **Validates output** (checks JSON format, key counts)

However, **native speaker review is recommended** for production use!

## Next Steps

After translation is complete:

1. ✅ Test thoroughly in the app
2. ✅ Get native speaker review (German, Russian)
3. ✅ Fix any issues found
4. ✅ Commit and push to repository
5. ✅ Repeat for other languages if needed (use same process)

---

**Questions?** Check the main TRANSLATION_GUIDE_EN.md or create an issue on GitHub.
