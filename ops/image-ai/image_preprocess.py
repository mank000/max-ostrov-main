"""CPU image transform matching the selected timm evaluation configuration."""
import io
import threading
from contextlib import contextmanager

import numpy as np
from PIL import Image, ImageOps

_decode_condition = threading.Condition()
_decode_reserved = 0
# One rotated 40MP image plus resize buffers, or several smaller images.
_DECODE_PIXEL_BUDGET = 84_000_000


@contextmanager
def _reserve_decode(pixels):
    global _decode_reserved
    if pixels > _DECODE_PIXEL_BUDGET:
        raise ValueError('Image geometry exceeds bounded preprocessing budget')
    with _decode_condition:
        _decode_condition.wait_for(
            lambda: _decode_reserved + pixels <= _DECODE_PIXEL_BUDGET
        )
        _decode_reserved += pixels
    try:
        yield
    finally:
        with _decode_condition:
            _decode_reserved -= pixels
            _decode_condition.notify_all()


def preprocess(data: bytes, config: dict) -> np.ndarray:
    _, height, width = config['input_size']
    if config.get('crop_mode', 'center') != 'center' or height != width:
        raise ValueError('Only square center-crop configurations are validated')
    resize = int(np.floor(height / config.get('crop_pct', 1.)))
    interpolation = {
        'bicubic': Image.Resampling.BICUBIC,
        'bilinear': Image.Resampling.BILINEAR,
        'nearest': Image.Resampling.NEAREST,
    }[config['interpolation']]
    with Image.open(io.BytesIO(data)) as original:
        w, h = original.size
        if w*h > 40_000_000:
            raise ValueError('Image exceeds 40 megapixels')
        scaled_pixels = resize * int(resize * max(w, h) / min(w, h))
        with _reserve_decode(2*w*h + scaled_pixels):
            im = None
            try:
                ImageOps.exif_transpose(original, in_place=True)
                im = original if original.mode == 'RGB' else original.convert('RGB')
                w, h = im.size
                shape = (resize, int(resize*h/w)) if w < h else (int(resize*w/h), resize)
                im = im.resize(shape, interpolation)
                w, h = im.size
                left, top = round((w-width)/2), round((h-height)/2)
                im = im.crop((left, top, left+width, top+height))
                array = np.asarray(im, dtype=np.float32).transpose(2, 0, 1) / 255.
            finally:
                if im is not None and im is not original:
                    im.close()
                original.close()
    mean = np.asarray(config['mean'], dtype=np.float32)[:, None, None]
    std = np.asarray(config['std'], dtype=np.float32)[:, None, None]
    return np.ascontiguousarray((array-mean)/std)
