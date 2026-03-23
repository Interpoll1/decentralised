import json
import sys
from collections import defaultdict
from pathlib import Path


def load_json(filepath):
    with open(filepath, "r", encoding="utf-8") as f:
        return json.load(f)


def check_dataset(data, label="dataset"):
    print(f"\n{'='*60}")
    print(f"  FILE: {label}")
    print(f"{'='*60}")

    total = len(data)
    print(f"\n  Total entries       : {total}")

    # Label distribution
    label_counts = defaultdict(int)
    for entry in data:
        label_counts[entry.get("label", "missing")] += 1
    print(f"  Label=1 (speak)     : {label_counts[1]} ({label_counts[1]/total*100:.1f}%)")
    print(f"  Label=0 (silent)    : {label_counts[0]} ({label_counts[0]/total*100:.1f}%)")

    # Meeting type distribution
    print(f"\n  Meeting type breakdown:")
    mt_counts = defaultdict(int)
    for entry in data:
        mt_counts[entry.get("meeting_type", "missing")] += 1
    for mt, count in sorted(mt_counts.items()):
        print(f"    {mt:<20}: {count}")

    # Speaker distribution
    print(f"\n  Speaker breakdown:")
    sp_counts = defaultdict(int)
    for entry in data:
        sp_counts[entry.get("speaker", "missing")] += 1
    for sp, count in sorted(sp_counts.items()):
        print(f"    {sp:<20}: {count}")

    # Exact duplicate detection on 'text' field
    seen_texts = {}
    exact_dupes = []
    for i, entry in enumerate(data):
        text = entry.get("text", "").strip()
        if text in seen_texts:
            exact_dupes.append((seen_texts[text], i, text[:80]))
        else:
            seen_texts[text] = i

    print(f"\n  Exact duplicate texts : {len(exact_dupes)}")
    if exact_dupes:
        print(f"\n  Duplicate details:")
        for orig_idx, dupe_idx, preview in exact_dupes:
            print(f"    Index {orig_idx} <-> {dupe_idx} | \"{preview}...\"")

    # Near-duplicate detection (first 60 chars)
    seen_prefixes = {}
    near_dupes = []
    exact_texts = {entry.get("text", "").strip() for entry in data}
    for i, entry in enumerate(data):
        text = entry.get("text", "").strip()
        prefix = text[:60].lower()
        if prefix in seen_prefixes:
            prev_text = data[seen_prefixes[prefix]].get("text", "").strip()
            if prev_text != text:  # only flag if not already an exact dupe
                near_dupes.append((seen_prefixes[prefix], i, text[:80]))
        else:
            seen_prefixes[prefix] = i

    print(f"  Near-duplicate texts  : {len(near_dupes)} (same first 60 chars, different text)")
    if near_dupes:
        print(f"\n  Near-duplicate details:")
        for orig_idx, dupe_idx, preview in near_dupes[:10]:
            print(f"    Index {orig_idx} <-> {dupe_idx} | \"{preview}...\"")
        if len(near_dupes) > 10:
            print(f"    ... and {len(near_dupes) - 10} more")

    # Repeated reasons (more than 3 times)
    seen_reasons = defaultdict(list)
    for i, entry in enumerate(data):
        reason = entry.get("reason", "").strip().lower()
        seen_reasons[reason].append(i)

    repeated_reasons = {r: idxs for r, idxs in seen_reasons.items() if len(idxs) > 3}
    print(f"\n  Reasons used more than 3 times: {len(repeated_reasons)}")
    if repeated_reasons:
        for reason, idxs in sorted(repeated_reasons.items(), key=lambda x: -len(x[1]))[:10]:
            print(f"    \"{reason}\" used {len(idxs)}x")

    return {
        "total": total,
        "exact_dupes": len(exact_dupes),
        "near_dupes": len(near_dupes),
        "label_1": label_counts[1],
        "label_0": label_counts[0],
    }


def merge_and_check(files):
    all_data = []
    file_stats = []

    for filepath in files:
        path = Path(filepath)
        if not path.exists():
            print(f"  [WARNING] File not found: {filepath}")
            continue
        try:
            data = load_json(filepath)
        except json.JSONDecodeError as e:
            print(f"  [ERROR] Could not parse {filepath}: {e}")
            continue
        if not isinstance(data, list):
            print(f"  [WARNING] {filepath} is not a JSON array — skipping")
            continue
        stats = check_dataset(data, label=path.name)
        file_stats.append((path.name, stats))
        all_data.extend(data)

    if len(file_stats) > 1 and all_data:
        print(f"\n{'='*60}")
        print(f"  COMBINED DATASET ({len(file_stats)} files merged)")
        print(f"{'='*60}")
        combined_stats = check_dataset(all_data, label="ALL FILES COMBINED")

        print(f"\n  Per-file summary:")
        print(f"  {'File':<40} {'Entries':>8} {'Dupes':>8} {'L=1':>6} {'L=0':>6}")
        print(f"  {'-'*40} {'-'*8} {'-'*8} {'-'*6} {'-'*6}")
        for name, s in file_stats:
            print(f"  {name:<40} {s['total']:>8} {s['exact_dupes']:>8} {s['label_1']:>6} {s['label_0']:>6}")
        print(f"  {'TOTAL':<40} {combined_stats['total']:>8} {combined_stats['exact_dupes']:>8} {combined_stats['label_1']:>6} {combined_stats['label_0']:>6}")
    elif len(file_stats) == 0:
        print("\n  No valid files were loaded.")


if __name__ == "__main__":
    files = ["x.json"]
    merge_and_check(files)
    print(f"\n{'='*60}\n  Done.\n{'='*60}\n")