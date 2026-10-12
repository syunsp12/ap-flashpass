"""
scripts/merge_questions.py
Audit, validate, deduplicate and integrate all AP exam question parts into master datasets.
"""

import json
import os
import sys

def main():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data_dir = os.path.join(base_dir, 'data')

    tech_file = os.path.join(data_dir, 'technology.json')
    tech_p2_file = os.path.join(data_dir, 'tech_part2.json')
    mgmt_file = os.path.join(data_dir, 'management_strategy.json')
    mgmt_p2_file = os.path.join(data_dir, 'mgmt_strat_part2.json')
    default_js_file = os.path.join(data_dir, 'default_data.js')

    # Load Technology
    tech_cards = []
    if os.path.exists(tech_file):
        with open(tech_file, 'r', encoding='utf-8') as f:
            tech_cards = json.load(f)
    print(f"Base Tech cards: {len(tech_cards)}")

    if os.path.exists(tech_p2_file):
        with open(tech_p2_file, 'r', encoding='utf-8') as f:
            tech_p2 = json.load(f)
        print(f"Tech Part 2 cards: {len(tech_p2)}")
        
        existing_terms = {c['term'].strip().lower() for c in tech_cards}
        existing_ids = {c['id'] for c in tech_cards}
        added_count = 0
        for c in tech_p2:
            term_clean = c['term'].strip().lower()
            if term_clean in existing_terms:
                continue
            if c['id'] in existing_ids:
                c['id'] = f"tech-add-{added_count+1:03d}"
            existing_ids.add(c['id'])
            existing_terms.add(term_clean)
            tech_cards.append(c)
            added_count += 1
        print(f"Added {added_count} new Tech cards. Total: {len(tech_cards)}")
        with open(tech_file, 'w', encoding='utf-8') as f:
            json.dump(tech_cards, f, ensure_ascii=False, indent=2)

    # Load Management & Strategy
    mgmt_cards = []
    if os.path.exists(mgmt_file):
        with open(mgmt_file, 'r', encoding='utf-8') as f:
            mgmt_cards = json.load(f)
    print(f"Base Mgmt/Strategy cards: {len(mgmt_cards)}")

    if os.path.exists(mgmt_p2_file):
        with open(mgmt_p2_file, 'r', encoding='utf-8') as f:
            mgmt_p2 = json.load(f)
        print(f"Mgmt/Strategy Part 2 cards: {len(mgmt_p2)}")

        existing_terms = {c['term'].strip().lower() for c in mgmt_cards}
        existing_ids = {c['id'] for c in mgmt_cards}
        added_count = 0
        for c in mgmt_p2:
            term_clean = c['term'].strip().lower()
            if term_clean in existing_terms:
                continue
            if c['id'] in existing_ids:
                c['id'] = f"mgmt-add-{added_count+1:03d}"
            existing_ids.add(c['id'])
            existing_terms.add(term_clean)
            mgmt_cards.append(c)
            added_count += 1
        print(f"Added {added_count} new Mgmt/Strategy cards. Total: {len(mgmt_cards)}")
        with open(mgmt_file, 'w', encoding='utf-8') as f:
            json.dump(mgmt_cards, f, ensure_ascii=False, indent=2)

    # Merge All
    total_cards = tech_cards + mgmt_cards
    print(f"Total Integrated Cards: {len(total_cards)}")

    # Category breakdown
    cat_counts = {}
    subcat_counts = {}
    for c in total_cards:
        cat = c.get('category', 'その他')
        sub = c.get('subCategory', 'その他')
        cat_counts[cat] = cat_counts.get(cat, 0) + 1
        subcat_counts[f"{cat} / {sub}"] = subcat_counts.get(f"{cat} / {sub}", 0) + 1

    print("\n--- Category Breakdown ---")
    for k, v in cat_counts.items():
        print(f"{k}: {v}問")

    # Update default_data.js
    with open(default_js_file, 'w', encoding='utf-8') as f:
        f.write('/** AP FlashPass - Curated High-Frequency Exam Dataset */\nwindow.DEFAULT_DATA = ' + json.dumps(total_cards, ensure_ascii=False, indent=2) + ';\n')
    print(f"\ndefault_data.js successfully written with {len(total_cards)} cards!")

if __name__ == '__main__':
    main()
