#!/usr/bin/env python3
"""Simple pixel diff using PIL/Pillow."""
import sys
from pathlib import Path

try:
    from PIL import Image
    import numpy as np
except ImportError:
    print("Installing Pillow+numpy...")
    import subprocess
    subprocess.run([sys.executable, "-m", "pip", "install", "Pillow", "numpy", "-q"])
    from PIL import Image
    import numpy as np

BASELINE_DIR = Path("screenshots/baseline")
ITER_DIR = Path("screenshots/iter5")
SHAPES = ["natural", "milkyway", "saturn", "sun", "brain"]

print("\nPixel diff results (iter5 vs baseline):")
for shape in SHAPES:
    bp = BASELINE_DIR / f"{shape}.png"
    ip = ITER_DIR / f"{shape}.png"
    if not ip.exists():
        print(f"  ? {shape}: iter5 screenshot missing")
        continue
    if not bp.exists():
        print(f"  ? {shape}: baseline screenshot missing")
        continue
    b = np.array(Image.open(bp).convert("RGB"), dtype=float)
    i = np.array(Image.open(ip).convert("RGB"), dtype=float)
    # Crop to min size
    h = min(b.shape[0], i.shape[0])
    w = min(b.shape[1], i.shape[1])
    b = b[:h, :w]
    i = i[:h, :w]
    diff = np.abs(b - i) / 255.0
    mean_diff = diff.mean()
    similarity = (1 - mean_diff) * 100
    status = "✓" if similarity >= 70 else "⚠"
    print(f"  {status} {shape}: {similarity:.1f}% similar (mean diff: {mean_diff:.4f})")
