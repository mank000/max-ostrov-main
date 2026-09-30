"""Evaluate the exact serving pipeline on a local, age-labelled image manifest.

Manifest: [{"file": "0001.jpg", "age": 17, "sha256": "..."}]. Images stay local.
FairFace manifests may instead use age_bin (0-8); these are broad age ranges.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path


AGE_BINS = ((0, 2), (3, 9), (10, 19), (20, 29), (30, 39),
            (40, 49), (50, 59), (60, 69), (70, 100))


def report(rows):
    exact = [row for row in rows if "age" in row]
    bands = [row for row in rows if "age_bin" in row]
    result = {"evaluated": len(rows)}
    if exact:
        result["mae"] = sum(abs(row["estimated"] - row["age"]) for row in exact) / len(exact)
        for age in (17, 18):
            at_age = [row for row in exact if row["age"] == age]
            result[f"age_{age}_count"] = len(at_age)
            if at_age:
                # The Go API rounds the estimate before it compares it with the profile.
                result[f"age_{age}_rounded_18_plus"] = sum(row["estimated"] >= 17.5 for row in at_age)
                result[f"age_{age}_mae"] = sum(abs(row["estimated"] - age) for row in at_age) / len(at_age)
    if bands:
        distances = []
        for row in bands:
            low, high = AGE_BINS[row["age_bin"]]
            distances.append(max(low - row["estimated"], 0, row["estimated"] - high))
        result["age_band_accuracy"] = sum(distance == 0 for distance in distances) / len(distances)
        result["mean_distance_outside_band"] = sum(distances) / len(distances)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("images", type=Path, help="directory containing manifest.json and its images")
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--margin", type=float, choices=(0.10, 0.18), default=0.10)
    args = parser.parse_args()
    os.environ["FACE_AI_MODEL_DIR"] = str(args.model_dir)
    import server

    server.FACE_MARGIN = args.margin
    manifest = json.loads((args.images / "manifest.json").read_text())
    root = args.images.resolve()
    rows = []
    rejected = 0
    for item in manifest:
        image_path = (root / item["file"]).resolve()
        if not image_path.is_relative_to(root):
            raise ValueError("manifest image path escapes dataset directory")
        data = image_path.read_bytes()
        if item.get("sha256") and hashlib.sha256(data).hexdigest() != item["sha256"]:
            raise ValueError(f"image checksum mismatch: {item['file']}")
        try:
            analysis = server.analyze(data)
        except ValueError:
            rejected += 1
            continue
        if analysis["face_count"] != 1:
            rejected += 1
            continue
        rows.append({"age": item["age"], "estimated": analysis["age"]} if "age" in item
                    else {"age_bin": item["age_bin"], "estimated": analysis["age"]})
    print(json.dumps({"model_sha256": server.AGE_MODEL_SHA256, "manifest_size": len(manifest),
                      "rejected": rejected, "margin": args.margin, **report(rows)}, indent=2))


if __name__ == "__main__":
    main()
