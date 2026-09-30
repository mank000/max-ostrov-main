# Facial age and avatar comparison

## Production placement

Current production worker runs on `135.106.196.216` as
`kutezh-tg-face-ai.service` and listens on `127.0.0.1:18291`. The
`kutezh-tg-` prefix is historical. Generic `ops/kutezh-face-ai.service` and
the server default port `8091` are standalone/install defaults, not the live
production route. The obsolete 135→147 AI tunnel is not part of the current
production path. See `docs/INFRASTRUCTURE.md`.

Age-only inference using locally quantized ONNX ViT, source: https://huggingface.co/onnx-community/age-gender-prediction-ONNX/tree/6c138f6454d37dd55e5d4648e23e1ec23844e705 (Apache-2.0 model card). Gender output is discarded. Quantization: dynamic signed INT8 per-channel MatMul/Gemm; preprocessing RGB 224px, ImageNet mean/std; YuNet face crop with 10% margin. The weights are unchanged; the inference crop was selected by measuring the serving pipeline on separate public age datasets.

Model age_vit_int8.onnx must be staged in FACE_AI_MODEL_DIR before deployment; server verifies SHA256. Existing legacy weights remain available for rollback. Installer requires this artifact explicitly instead of downloading unpinned replacement weights.

The same request can include the current primary avatar in a length-prefixed
`application/x-kutezh-face-pair` body: four big-endian bytes for the scan length,
then the scan and avatar JPEG/PNG bytes. YuNet must find exactly one confident,
large face in each image. OpenCV SFace INT8 aligns both faces and compares cosine
embeddings. The pinned SFace weight SHA256 is
`2b0e941e6f16cc048c20aee0c8e31f569118f65d702914540f7bfdc14048d78a`;
stage this file in `FACE_AI_MODEL_DIR` before enabling automatic comparison.
The server verifies its checksum at startup when enabled. A cosine score of at
least 0.60 sets `avatar_match=true`; otherwise age verification can still earn
a yellow badge. Automatic comparison is disabled by default. Set
`FACE_AI_AUTO_MATCH_ENABLED=1` only after validating the threshold on a fixed,
representative pair and presentation-attack set. `/health` reports
`auto_avatar_match`. The threshold is deliberately above the [OpenCV Zoo demo's
default](https://github.com/opencv/opencv_zoo/blob/main/models/face_recognition_sface/sface.py),
but it has **not** been calibrated on MAX users or presentation attacks.
The scan and avatar are processed in memory and discarded. This comparison is
not a liveness or legal identity check; manual review remains available.
If a separately managed shared Face AI worker still supports only age-only
requests, the Go API retries the scan without an avatar and grants at most the
yellow badge. Automatic blue badges require the pinned SFace model and explicit
enablement on the actual worker serving `KUTEZH_FACE_AI_URL`.
In production, first inspect `systemctl cat kutezh-tg-face-ai.service` to find
its root-owned EnvironmentFile. Enable `FACE_AI_AUTO_MATCH_ENABLED=1` there
only after calibration, restart that unit, and require
`http://127.0.0.1:18291/health` to report `"auto_avatar_match":true`.
Do not assume the generic `/etc/kutezh-face-ai.env`/8091 unit is the live worker.

Local SFace smoke test with OpenCV 4.14 and public `face_recognition` example
images: two Obama photos scored 0.7521, Obama/Biden 0.1206 and 0.2523.
This three-pair check confirms model loading and score direction, not accuracy
or demographic fairness. No private user images were used.

The former 18% crop and the 10% crop were compared with the same weights and face-quality requirements:

- Public UTKFace test (284 usable images): MAE 3.775 → 3.768 years. UTKFace is the source model's reported training dataset, so this is only a diagnostic check.
- Public FairFace (162 usable images, broad age bands): correct band 43.2% → 47.5%; mean distance outside the band 3.16 → 2.93 years.
- Public AgeDB exploration (274 usable images): MAE 7.322 → 6.398 years.
- AgeDB **held-out images not used to select the crop** (126 usable): MAE 7.497 → 6.606 years. For 47 images labelled 17, 38 → 32 still rounded to 18+; for 79 images labelled 18, 70 → 67 rounded to 18+. These are images, not distinct people; age labels and photographic conditions differ from the live camera.

AgeDB came from [this public mirror](https://huggingface.co/datasets/ljnlonoljpiljm/agedb) at revision `8b019842938caf30b789dbecae56383684be716d`; the exploration sample used seed 928 and up to 30 images per age 13–20. All remaining 17/18 images formed the holdout. The [original AgeDB paper](https://openaccess.thecvf.com/content_cvpr_2017_workshops/w33/html/Moschoglou_AgeDB_The_First_CVPR_2017_paper.html) describes its age annotations. Public dataset images are used locally for evaluation only and are not redistributed with this repository.

The smaller crop improves the observed error but does not resolve the 17/18 boundary. No face-based estimate proves adulthood. Existing profile-DOB and ±10-year matching rules remain unchanged; invalid/small/low-confidence faces fail. No private user images were used for training or evaluation.

For repeatable local checks, stage the pinned model and YuNet weights in `FACE_AI_MODEL_DIR`, then run `python face-ai/evaluate.py /path/to/images --model-dir "$FACE_AI_MODEL_DIR" --margin 0.10` and compare with `--margin 0.18`. The directory must contain `manifest.json` with `file`, `age` (or `age_bin` for FairFace) and ideally `sha256` for each image. The evaluator reports only aggregate metrics; do not commit dataset images.

One inference at a time; at most two admitted request bodies; extra requests receive 503. OpenCV and ONNX use one thread, systemd caps memory to 512 MB. No face images are persisted by this service.

Successful `/analyze` responses include the pinned weight checksum in `model_version` and crop revision in `pipeline_version`; the Go API can continue using the existing `age` and `face_score` fields.
