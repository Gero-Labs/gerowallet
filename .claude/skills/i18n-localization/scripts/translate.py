#!/usr/bin/env python3
"""
Translation helper script for Gero Wallet i18n files.
Extracts all translation keys and values from us.ts for manual translation.
"""
import sys
import re
from pathlib import Path

def extract_translations(file_path):
    """Extract all translation key-value pairs from a TypeScript file."""
    content = file_path.read_text(encoding='utf-8')

    # Pattern to match: 'key': 'value',
    # Handles multiline strings and escaped quotes
    pattern = r"^\s*'([^']+)':\s*'((?:[^'\\]|\\.)*)'\s*,?\s*$"

    translations = []
    for line in content.split('\n'):
        match = re.match(pattern, line)
        if match:
            key = match.group(1)
            value = match.group(2)
            translations.append((key, value))

    return translations

def write_translation_template(translations, output_path, lang_name):
    """Write a template file with keys for translation."""
    with output_path.open('w', encoding='utf-8') as f:
        f.write(f'/**\n * {lang_name} translations\n */\n')
        f.write('export default {\n')

        for key, value in translations:
            # Write key with placeholder for translation
            f.write(f"  '{key}': '',  // TODO: {value}\n")

        f.write('}\n')

def main():
    us_file = Path('src/plugins/i18n/us.ts')

    if not us_file.exists():
        print(f"Error: {us_file} not found")
        sys.exit(1)

    print("Extracting translations from us.ts...")
    translations = extract_translations(us_file)
    print(f"Found {len(translations)} translation keys")

    # Write templates
    for lang_code, lang_name in [('de', 'German'), ('ru', 'Russian')]:
        output = Path(f'src/plugins/i18n/{lang_code}_template.ts')
        write_translation_template(translations, output, lang_name)
        print(f"Created template: {output}")

if __name__ == "__main__":
    main()
