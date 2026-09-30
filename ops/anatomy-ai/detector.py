# SPDX-License-Identifier: AGPL-3.0-only
"""Bounded adapter for the independently deployed NudeNet component."""
import io,hashlib
from pathlib import Path
import numpy as np
import onnxruntime as ort
from PIL import Image,ImageOps
from upstream_nudenet import _read_image,_postprocess
import cv2
cv2.setNumThreads(1)
MODEL_SHA='c15d8273adad2d0a92f014cc69ab2d6c311a06777a55545f2c4eb46f51911f0f'
LABELS=('FEMALE_BREAST_EXPOSED','FEMALE_GENITALIA_EXPOSED','MALE_GENITALIA_EXPOSED','ANUS_EXPOSED')
def load(path):
 if hashlib.sha256(Path(path).read_bytes()).hexdigest()!=MODEL_SHA:raise RuntimeError('Anatomy model checksum mismatch')
 o=ort.SessionOptions();o.intra_op_num_threads=1;o.inter_op_num_threads=1;o.add_session_config_entry('session.intra_op.allow_spinning','0');o.add_session_config_entry('session.inter_op.allow_spinning','0');o.enable_cpu_mem_arena=False;o.enable_mem_pattern=False
 return ort.InferenceSession(str(path),sess_options=o,providers=['CPUExecutionProvider'])
def detect(data,session):
 # Bound decoding before creating OpenCV's padding buffers. Upload remains untouched.
 with Image.open(io.BytesIO(data)) as im:
  if im.format not in ('JPEG','PNG') or im.width*im.height>40_000_000:raise ValueError('Invalid image')
  if im.width*im.height>8_000_000:im.draft('RGB',(2048,2048))
  ImageOps.exif_transpose(im,in_place=True)
  if im.width*im.height>8_000_000:im.thumbnail((2048,2048),Image.Resampling.LANCZOS)
  rgb=im.convert('RGB');pixels=np.asarray(rgb)[:,:,::-1].copy();rgb.close()
 blob,xr,yr,xp,yp,w,h=_read_image(pixels)
 output=session.run(None,{session.get_inputs()[0].name:blob});items=_postprocess(output,xp,yp,xr,yr,w,h,320,320)
 return {l:max((a['score'] for a in items if a['class']==l),default=0.) for l in LABELS}
