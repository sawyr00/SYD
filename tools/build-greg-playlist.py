import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path
from urllib.parse import quote

from mutagen import File, MutagenError

FOLDER = Path("audio/comfy gaze playlist")
FORMATS = {".mp3", ".m4a", ".flac"}
TRACK_PREFIX = re.compile(r"^\s*(?:\d{1,2}-\d{2}|\d{1,2})(?:\s*[-._]\s*|\s+)")


def read_tags(path):
    try:
        track = File(path, easy=True)
        tags = track.tags if track else None
    except (OSError, MutagenError) as error:
        print(f"Could not read metadata for {path.name}: {error}")
        tags = None
    tags = tags or {}

    def first(*keys):
        return next(
            (str(value).strip() for key in keys for value in tags.get(key, []) if str(value).strip()),
            "",
        )

    filename_title = TRACK_PREFIX.sub("", path.stem)
    artist = first("artist", "performer", "author", "albumartist", "composer")
    title = first("title") or filename_title
    if title == path.stem:
        title = filename_title
    if not artist:
        artist, separator, candidate = filename_title.partition(" - ")
        if separator:
            title = candidate if title == filename_title else title
        else:
            artist = ""
    label = f"{artist} - {title}" if artist and not title.casefold().startswith(f"{artist} - ".casefold()) else title
    if not artist:
        print(f"No artist tag or filename artist: {path.name}")
    return label


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--site", type=Path, help="Build compatible MP3 copies in this site directory.")
    args = parser.parse_args()
    output = args.site or Path(".")
    entries = []
    for path in sorted(FOLDER.iterdir(), key=lambda file: (file.name.casefold(), file.name)):
        if not path.is_file() or path.suffix.lower() not in FORMATS:
            continue
        url = path.as_posix()
        if args.site:
            with path.open("rb") as song:
                digest = hashlib.file_digest(song, "sha256").hexdigest()[:24]
            url = f"audio/comfy-gaze/{digest}.mp3"
            target = output / url
            target.parent.mkdir(parents=True, exist_ok=True)
            subprocess.run(
                ["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(path), "-map", "0:a:0",
                 "-map_metadata", "-1", "-c:a", "libmp3lame", "-b:a", "192k", str(target)],
                check=True,
            )
        entries.append({"path": quote(url), "title": read_tags(path)})
    if not entries:
        raise SystemExit(f"No supported tracks found in {FOLDER}")
    (output / "greg-playlist.json").write_text(
        json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Wrote {len(entries)} Greg playlist entries.")


if __name__ == "__main__":
    main()
