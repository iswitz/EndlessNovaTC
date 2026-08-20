#!/usr/bin/env python3
"""Convert EV Nova PICT, rlëD, and snd resources into Endless Sky assets."""
import base64
import json
import math
import os
import shutil
import struct
import subprocess
import tempfile
import wave
from pathlib import Path

from PIL import Image

ROOT = Path(os.environ.get("EVN_OUTPUT", Path(__file__).resolve().parents[1] / "parsed-data"))
PLUGIN = Path(os.environ.get("ES_OUTPUT", Path(__file__).resolve().parents[1] / "converted-plugin"))
SOURCE = ROOT / "novaparse-source" / "Nova Files"
MEDIA = ROOT / "media-resources.json"
BURGER = json.loads((MEDIA if MEDIA.exists() else ROOT / "burger-resources.json").read_text(encoding="utf-8"))
NORMALIZED = json.loads((ROOT / "normalized.json").read_text(encoding="utf-8"))

IMAI_INDEX = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8]
IMAI_STEP = [7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767]

def u16(data, offset): return struct.unpack_from(">H", data, offset)[0]
def i16(data, offset): return struct.unpack_from(">h", data, offset)[0]
def u32(data, offset): return struct.unpack_from(">I", data, offset)[0]
def raw(resource): return base64.b64decode(resource["dataBase64"])
def slug(value):
    value = "".join(ch if ch.isalnum() else "_" for ch in str(value).lower()).strip("_")
    return value or "evn"
def resource_id(value):
    try:
        if isinstance(value, str) and ":" in value: return int(value.rsplit(":", 1)[1])
        return int(value)
    except (TypeError, ValueError):
        return None
def set_pixel(image, x, y, pixel):
    if 0 <= x < image.width and 0 <= y < image.height:
        blue = pixel & 0x1F
        green = (pixel >> 5) & 0x1F
        red = (pixel >> 10) & 0x1F
        image.putpixel((x, y), ((red << 3) | (red >> 2), (green << 3) | (green >> 2), (blue << 3) | (blue >> 2), 255))

def decode_rled(data):
    width, height, depth, frames = u16(data, 0), u16(data, 2), u16(data, 4), u16(data, 8)
    if depth != 16: raise ValueError(f"rlëD depth {depth}, expected 16")
    images = [Image.new("RGBA", (width, height), (0, 0, 0, 0)) for _ in range(max(frames, 1))]
    pointer, row_start, line, col, frame = 16, 0, -1, 0, 0
    while pointer + 4 <= len(data):
        if row_start and ((pointer - row_start) & 3): pointer += 4 - ((pointer - row_start) & 3)
        if pointer + 4 > len(data): break
        word = u32(data, pointer); pointer += 4
        opcode, count = word >> 24, word & 0xFFFFFF
        if opcode == 0:
            if line != height - 1: raise ValueError(f"rlëD frame has {line + 1} lines, expected {height}")
            frame += 1
            if frame >= len(images): break
            line, col, row_start = -1, 0, 0
        elif opcode == 1:
            line += 1; col = 0; row_start = pointer
        elif opcode == 2:
            for _ in range(count // 2):
                if pointer + 2 > len(data): raise ValueError("rlëD pixel data truncated")
                set_pixel(images[frame], col, line, u16(data, pointer)); pointer += 2; col += 1
            if count & 3: pointer += 4 - (count & 3)
        elif opcode == 3:
            col += count >> 1
        elif opcode == 4:
            if pointer + 4 > len(data): raise ValueError("rlëD pixel run truncated")
            pixel = u32(data, pointer) & 0xFFFF; pointer += 4
            for _ in range(count // 2): set_pixel(images[frame], col, line, pixel); col += 1
        else:
            raise ValueError(f"unknown rlëD opcode {opcode}")
    sheet = Image.new("RGBA", (width * len(images), height), (0, 0, 0, 0))
    for index, image in enumerate(images): sheet.paste(image, (index * width, 0), image)
    return sheet

def ima4_samples(data, length):
    samples = []; pointer = 0
    while pointer + 34 <= len(data) and len(samples) < length:
        control = struct.unpack_from(">H", data, pointer)[0]; pointer += 2
        index = min(control & 0x7F, 88); predictor = control - (control & 0x7F)
        for _ in range(32):
            byte = data[pointer]; pointer += 1
            for nibble in (byte & 0xF, byte >> 4):
                step = IMAI_STEP[index]
                predictor += (-1 if nibble & 8 else 1) * ((nibble & 7) + 0.5) * step / 4
                predictor = max(-32768, min(32767, predictor))
                samples.append(int(predictor))
                index = max(0, min(88, index + IMAI_INDEX[nibble]))
                if len(samples) >= length: return samples
    return samples

def decode_snd(data):
    pointer = 0; fmt = u16(data, pointer); pointer += 2
    if fmt == 1:
        count = u16(data, pointer); pointer += 2
        if count: pointer += 2 + 4
    elif fmt == 2: pointer += 2
    else: raise ValueError(f"snd format {fmt}")
    if u16(data, pointer) != 1: raise ValueError("snd has multiple commands")
    pointer += 2
    command = u16(data, pointer); pointer += 2
    pointer += 2
    sample_offset = u32(data, pointer); pointer += 4
    if not (command & 0x8000) or (command & 0x7FFF) != 81: raise ValueError("snd is not an immediate buffer")
    p = sample_offset
    if u32(data, p) != 0: raise ValueError("snd sample pointer is not immediate")
    length = u32(data, p + 4); rate = u32(data, p + 8) / 65536.0; encoding = data[p + 20]; p += 22
    if encoding == 0:
        samples = [int((value - 127.5) / 127.5 * 32767) for value in data[p:p + length]]
    elif encoding == 0xFE:
        # Compressed sample header starts with sample count immediately after encoding/baseFreq.
        length = u32(data, p); p += 4
        p += 10 + 4 + 4 + 4 + 4 + 4 + 2 + 2 + 2 + 2
        codec = data[p - 24:p - 20].decode("latin1")
        if codec != "ima4": raise ValueError(f"snd codec {codec}")
        samples = ima4_samples(data[p:], length)
    else: raise ValueError(f"snd encoding {encoding}")
    if not samples: return samples
    target = 44100; out_len = max(1, round(len(samples) * target / rate))
    output = []
    for n in range(out_len):
        position = n * (len(samples) - 1) / max(out_len - 1, 1); left = int(position); right = min(left + 1, len(samples) - 1); frac = position - left
        output.append(round(samples[left] * (1 - frac) + samples[right] * frac))
    return output

def write_wav(path, samples):
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1); out.setsampwidth(2); out.setframerate(44100)
        out.writeframes(b"".join(struct.pack("<h", max(-32768, min(32767, sample))) for sample in samples))

def run_rsrcdump(source, workdir):
    module = Path(__file__).resolve().parents[1] / "vendor" / "rsrcdump"
    command = [os.environ.get("RSRCDUMP_PYTHON", os.sys.executable), "-m", "rsrcdump", "--extract", str(source)]
    env = os.environ.copy(); env["PYTHONPATH"] = str(module)
    result = subprocess.run(command, cwd=workdir, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if result.returncode: raise RuntimeError(result.stderr[-1000:] or result.stdout[-1000:])
    return workdir / (source.name + ".json"), workdir / (source.name + ".json_resources")

def main():
    images = PLUGIN / "images"; sounds = PLUGIN / "sounds"; images.mkdir(parents=True, exist_ok=True); sounds.mkdir(parents=True, exist_ok=True)
    asset_manifest = {"pict": {}, "rlëD": {}, "sounds": {}, "errors": []}
    pict_paths, rled_paths = {}, {}
    for target in (images / "raw" / "PICT").glob("*.png"):
        try:
            pict_paths[int(target.stem)] = target
            asset_manifest["pict"][target.stem] = str(target.relative_to(PLUGIN)).replace("\\", "/")
        except ValueError:
            pass
    with tempfile.TemporaryDirectory(prefix="evn-assets-") as temp:
        temp_path = Path(temp)
        existing_picts = list((images / "raw" / "PICT").glob("*.png"))
        if os.environ.get("ASSET_FORCE_RSRCDUMP"):
            sources = sorted(SOURCE.glob("*.ndat"))
        else:
            sources = [] if os.environ.get("ASSET_SKIP_RSRCDUMP") or existing_picts else sorted(SOURCE.glob("*.ndat"))
        for source in sources:
            try:
                json_path, resource_dir = run_rsrcdump(source, temp_path)
                extracted = json.loads(json_path.read_text(encoding="utf-8"))
                for kind in ("PICT", "cicn", "ppat"):
                    for rid, entry in extracted.get(kind, {}).items():
                        source_file = resource_dir / entry["file"]
                        if not source_file.exists(): continue
                        target = images / "raw" / kind / f"{rid}.png"; target.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(source_file, target)
                        if kind == "PICT": pict_paths[int(rid)] = target; asset_manifest["pict"][rid] = str(target.relative_to(PLUGIN)).replace("\\", "/")
            except Exception as error: asset_manifest["errors"].append({"source": source.name, "stage": "PICT", "error": str(error)})
    for resource in BURGER["resources"]:
        kind, rid = resource["type"], int(resource["id"])
        if kind not in ("rlëD", "snd "): continue
        data = raw(resource)
        try:
            if kind == "rlëD":
                target = images / "raw" / "rlëD" / f"{rid}.png"; target.parent.mkdir(parents=True, exist_ok=True)
                if not target.exists(): decode_rled(data).save(target)
                rled_paths[rid] = target; asset_manifest["rlëD"][str(rid)] = str(target.relative_to(PLUGIN)).replace("\\", "/")
            elif kind == "snd ":
                target = sounds / f"evn-{rid}.wav"
                if not target.exists() or target.stat().st_size <= 48: write_wav(target, decode_snd(data))
                asset_manifest["sounds"][str(rid)] = str(target.relative_to(PLUGIN)).replace("\\", "/")
        except Exception as error: asset_manifest["errors"].append({"type": kind, "id": rid, "stage": "rlëD/snd", "error": str(error)})
    def alias(kind, value, name):
        if value is None or name is None: return False
        rid = resource_id(value)
        if rid is None: return False
        source = pict_paths.get(rid) or rled_paths.get(rid)
        if source:
            target = images / kind / f"{slug(name)}.png"; target.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(source, target)
            if kind == "planet":
                land = images / "land" / f"{slug(name)}.png"; land.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(source, land)
            elif kind == "ship":
                thumbnail = images / "thumbnail" / f"{slug(name)}.png"; thumbnail.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(source, thumbnail)
            return True
        return False
    alias_stats = {}
    def aliases(kind, items, value_key):
        values = list(items)
        converted = sum(alias(kind, item.get(value_key), item.get("name")) for item in values)
        alias_stats[kind] = {"converted": converted, "total": len(values), "missing": len(values) - converted}
    aliases("ship", NORMALIZED.get("Ship", {}).values(), "pict")
    aliases("planet", NORMALIZED.get("Planet", {}).values(), "landingPict")
    aliases("outfit", NORMALIZED.get("Outfit", {}).values(), "pict")
    weapon_items = list(NORMALIZED.get("Weapon", {}).values())
    converted = 0
    for item in weapon_items:
        animation = item.get("animation", {}); image = animation.get("images", {}).get("baseImage", {})
        converted += alias("projectile", image.get("id"), item.get("name"))
    alias_stats["projectile"] = {"converted": converted, "total": len(weapon_items), "missing": len(weapon_items) - converted}
    asset_manifest["aliases"] = alias_stats
    asset_manifest["pictExpected"] = sum(1 for resource in json.loads((ROOT / "burger-resources.json").read_text(encoding="utf-8"))["resources"] if resource["type"] == "PICT")
    asset_manifest["pictMissing"] = max(0, asset_manifest["pictExpected"] - len(pict_paths))
    manifest_path = PLUGIN / "conversion-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    manifest["assets"] = asset_manifest; manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"plugin": str(PLUGIN), "pict": len(pict_paths), "rlëD": len(rled_paths), "sounds": len(asset_manifest["sounds"]), "errors": len(asset_manifest["errors"])}, ensure_ascii=False, indent=2))

if __name__ == "__main__": main()
