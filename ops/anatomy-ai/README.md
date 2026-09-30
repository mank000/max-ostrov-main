# Independent anatomical detector component

This component contains NudeNet 3.4.2 `nudenet.py` renamed to
`upstream_nudenet.py`, unmodified, plus the bounded `detector.py` adapter and
`server.py` loopback HTTP service. Component sources use AGPL-3.0-only; see LICENSE.
The wheel's metadata says MIT but both bundled license files contain AGPL-3.0;
we retain and supply those license terms rather than relying on the metadata.
Other application components retain their existing licensing.

Source package: https://pypi.org/project/nudenet/3.4.2/
Upstream listed by the package: https://github.com/notAI-tech/NudeNet
The 320n.onnx model is extracted unchanged from the 3.4.2 wheel.
No user images, uploads, credentials, or locally trained private weights are included.

Reproduce:
1. Use Python 3.11+ and install the versions in requirements.txt in a virtualenv.
2. `python -m pip download --no-deps nudenet==3.4.2`
3. Extract `nudenet/320n.onnx` from that ZIP-format wheel to `models/320n.onnx`.
4. Verify the model SHA256 declared in detector.py; run `python server.py`.
   The standalone server listens only on 127.0.0.1:8096 by default.
5. Production currently runs on `135.106.196.216` as
   `kutezh-tg-anatomy-ai.service` on `127.0.0.1:18296`; the 8096 value is
   not the production port.
6. Deployment unit and installer are included in the source archive.

GET /health exposes the source URL. POST /analyze accepts JPEG/PNG bytes and
returns scores, never a legal determination. The caller makes community-policy
choices separately. Images are not persisted and inference has one execution slot.
The deployed corresponding source archive is available at:
https://kutezh-social.ru/ai-components/anatomy-source.zip
