"""Extract the Google Drive export zips onto D: and verify what arrived.

Layout after extraction:
    D:/vayu_data/oisst_sst_india/   daily OISST, already India-subsetted
    D:/vayu_data/lst_india/         ERA5-Land LST yearly files (1981-1999)
    D:/vayu_data/lst_static/        India_MODIS_LST_Mean_2000_2025.tif

Drive splits large exports across multiple zips arbitrarily, so the two
oisst_sst_india halves are merged into one directory. Extraction is skip-if-
present so this is safe to re-run after an interrupted pass.
"""
from __future__ import annotations

import io
import sys
import zipfile
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

DL = Path.home() / "Downloads"
ROOT = Path("D:/vayu_data")

DEST = {
    "oisst_sst_india": ROOT / "oisst_sst_india",
    "lst_india_1981_1999": ROOT / "lst_india",
    "(root)": ROOT / "lst_static",
}


def main() -> int:
    for d in DEST.values():
        d.mkdir(parents=True, exist_ok=True)

    written = skipped = 0
    for z in sorted(DL.glob("drive-download*.zip")):
        print(f"--- {z.name} ---", flush=True)
        with zipfile.ZipFile(z) as zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue
                parts = info.filename.split("/")
                top = parts[0] if len(parts) > 1 else "(root)"
                dest_dir = DEST.get(top)
                if dest_dir is None:
                    print(f"  ?? unexpected entry, skipping: {info.filename}")
                    continue
                out = dest_dir / parts[-1]
                if out.exists() and out.stat().st_size == info.file_size:
                    skipped += 1
                    continue
                with zf.open(info) as src, open(out, "wb") as dst:
                    while chunk := src.read(1 << 20):
                        dst.write(chunk)
                written += 1
                if written % 2000 == 0:
                    print(f"  extracted {written} files...", flush=True)
        print(f"  done ({written} written, {skipped} already present)", flush=True)

    print(f"\nEXTRACT_DONE written={written} skipped={skipped}")
    for name, d in DEST.items():
        files = list(d.glob("*"))
        size = sum(f.stat().st_size for f in files) / 1e6
        print(f"  {d.name:18} files={len(files):<6} {size:.1f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
