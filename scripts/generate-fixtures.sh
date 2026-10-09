#!/usr/bin/env bash
# Generates deterministic, license-free synthetic media fixtures for tests and
# the integration prototype. All content is produced from ffmpeg's lavfi test
# sources (testsrc2/smptebars/sine), so there are no third-party rights.
#
# Usage:
#   scripts/generate-fixtures.sh            # VP9 + Opus (works in open-source Chromium builds)
#   FIXTURE_CODEC=h264 scripts/generate-fixtures.sh   # H.264 + AAC (Safari / iOS manual testing)
#
# Output: tests/fixtures/media/ (gitignored). See tests/fixtures/media.json for
# the inventory and expected assertions.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${FIXTURE_OUT:-$ROOT/tests/fixtures/media}"
CODEC="${FIXTURE_CODEC:-vp9}"
DURATION=20
FPS=24
GOP=$((FPS * 2)) # 2 s GOP == 2 s segments, so packaging never splits a GOP
FONT="${FIXTURE_FONT:-/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf}"

command -v ffmpeg >/dev/null || { echo "ffmpeg is required" >&2; exit 1; }

if [[ "$CODEC" == "vp9" ]]; then
  VCODEC=(-c:v libvpx-vp9 -deadline good -cpu-used 5 -row-mt 1 -pix_fmt yuv420p)
  ACODEC=(-c:a libopus -b:a 64k -ar 48000)
  VCODEC_STR="vp09.00.30.08"
  ACODEC_STR="opus"
elif [[ "$CODEC" == "h264" ]]; then
  VCODEC=(-c:v libx264 -preset veryfast -profile:v main -pix_fmt yuv420p)
  ACODEC=(-c:a aac -b:a 96k -ar 48000)
  VCODEC_STR="avc1.4d401e"
  ACODEC_STR="mp4a.40.2"
else
  echo "Unknown FIXTURE_CODEC=$CODEC (expected vp9 or h264)" >&2
  exit 1
fi

rm -rf "$OUT"
mkdir -p "$OUT"/{mezz,mp4,hls,dash,subs,ads,broken,vast,images}
cd "$OUT"

# drawtext label: rendition name + media time, so a timeline mismatch between
# quality variants is visible to a human tester.
label() {
  local text="$1"
  echo "drawtext=fontfile=${FONT}:text='${text} %{pts\\:hms}':x=12:y=12:fontsize=h/12:fontcolor=white:box=1:boxcolor=black@0.6"
}

encode_video() { # name width height bitrate
  local name="$1" w="$2" h="$3" br="$4"
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "testsrc2=size=${w}x${h}:rate=${FPS}:duration=${DURATION}" \
    -vf "$(label "${name}")" \
    "${VCODEC[@]}" -b:v "$br" -maxrate "$br" -bufsize "$br" \
    -g "$GOP" -keyint_min "$GOP" -sc_threshold 0 -force_key_frames "expr:gte(t,n_forced*2)" \
    -an "mezz/${name}.mp4"
}

encode_audio() { # name freq
  local name="$1" freq="$2"
  ffmpeg -hide_banner -loglevel error -y \
    -f lavfi -i "sine=frequency=${freq}:sample_rate=48000:duration=${DURATION}" \
    "${ACODEC[@]}" -vn "mezz/${name}.mp4"
}

echo "[fixtures] encoding mezzanine renditions ($CODEC)"
encode_video 216p 384 216 250k
encode_video 360p 640 360 600k
encode_video 540p 960 540 1200k
encode_audio audio-en 440
encode_audio audio-mn 660

echo "[fixtures] progressive MP4 quality variants (same timeline)"
for r in 216p 360p 540p; do
  ffmpeg -hide_banner -loglevel error -y -i "mezz/${r}.mp4" -i mezz/audio-en.mp4 \
    -map 0:v -map 1:a -c copy -movflags +faststart "mp4/vod-${r}.mp4"
done

echo "[fixtures] portrait 9:16 MP4"
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "testsrc2=size=360x640:rate=${FPS}:duration=10" \
  -f lavfi -i "sine=frequency=520:sample_rate=48000:duration=10" \
  -vf "$(label portrait)" "${VCODEC[@]}" -b:v 500k -g "$GOP" "${ACODEC[@]}" \
  -movflags +faststart mp4/portrait.mp4

echo "[fixtures] ad creatives"
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "smptebars=size=640x360:rate=${FPS}:duration=6" \
  -f lavfi -i "sine=frequency=880:sample_rate=48000:duration=6" \
  -vf "$(label AD)" "${VCODEC[@]}" -b:v 400k -g "$GOP" "${ACODEC[@]}" \
  -movflags +faststart ads/ad-video.mp4
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "smptebars=size=640x100" -frames:v 1 ads/banner.png
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "testsrc2=size=640x360" -frames:v 1 images/poster.png

echo "[fixtures] HLS VOD (3 video renditions, 2 audio languages, 2 WebVTT subtitle tracks)"
for r in 216p 360p 540p; do
  mkdir -p "hls/${r}"
  ffmpeg -hide_banner -loglevel error -y -i "mezz/${r}.mp4" -c copy \
    -f hls -hls_time 2 -hls_playlist_type vod -hls_segment_type fmp4 \
    -hls_fmp4_init_filename init.mp4 -hls_segment_filename "hls/${r}/seg_%03d.m4s" "hls/${r}/index.m3u8"
done
for a in en mn; do
  mkdir -p "hls/audio-${a}"
  ffmpeg -hide_banner -loglevel error -y -i "mezz/audio-${a}.mp4" -c copy \
    -f hls -hls_time 2 -hls_playlist_type vod -hls_segment_type fmp4 \
    -hls_fmp4_init_filename init.mp4 -hls_segment_filename "hls/audio-${a}/seg_%03d.m4s" "hls/audio-${a}/index.m3u8"
done

# WebVTT subtitles. Cue text deliberately contains characters that must be
# rendered as text, never as markup.
write_vtt() { # file lang prefix
  local file="$1" prefix="$3"
  {
    echo "WEBVTT"
    echo
    local i=0
    while (( i < DURATION )); do
      printf '%02d:%02d.000 --> %02d:%02d.900\n' $((i / 60)) $((i % 60)) $(((i + 1) / 60)) $(((i + 1) % 60))
      echo "${prefix} ${i}s"
      echo
      i=$((i + 2))
    done
  } > "$file"
}
write_vtt subs/en.vtt en "EN cue"
write_vtt subs/mn.vtt mn "MN хадмал"
cat > subs/hostile.vtt <<'VTT'
WEBVTT

00:00.000 --> 00:05.000
<script>window.__xss = 1</script><img src=x onerror="window.__xss=1"> safe text
VTT
cat > subs/unsupported.srt <<'SRT'
1
00:00:00,000 --> 00:00:02,000
SRT is not accepted as an external format
SRT

for a in en mn; do
  cat > "hls/subs-${a}.m3u8" <<M3U8
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:${DURATION}
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD
#EXTINF:${DURATION}.000,
../subs/${a}.vtt
#EXT-X-ENDLIST
M3U8
done

cat > hls/master.m3u8 <<M3U8
#EXTM3U
#EXT-X-VERSION:7
#EXT-X-INDEPENDENT-SEGMENTS
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="en",DEFAULT=YES,AUTOSELECT=YES,CHANNELS="1",URI="audio-en/index.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Mongolian",LANGUAGE="mn",DEFAULT=NO,AUTOSELECT=YES,CHANNELS="1",URI="audio-mn/index.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",DEFAULT=NO,AUTOSELECT=YES,URI="subs-en.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Mongolian",LANGUAGE="mn",DEFAULT=NO,AUTOSELECT=YES,URI="subs-mn.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=330000,AVERAGE-BANDWIDTH=310000,RESOLUTION=384x216,FRAME-RATE=24.000,CODECS="${VCODEC_STR},${ACODEC_STR}",AUDIO="aud",SUBTITLES="subs"
216p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=700000,AVERAGE-BANDWIDTH=660000,RESOLUTION=640x360,FRAME-RATE=24.000,CODECS="${VCODEC_STR},${ACODEC_STR}",AUDIO="aud",SUBTITLES="subs"
360p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1300000,AVERAGE-BANDWIDTH=1260000,RESOLUTION=960x540,FRAME-RATE=24.000,CODECS="${VCODEC_STR},${ACODEC_STR}",AUDIO="aud",SUBTITLES="subs"
540p/index.m3u8
M3U8

echo "[fixtures] DASH VOD (3 video representations, 2 audio adaptation sets, 2 sidecar WebVTT)"
ffmpeg -hide_banner -loglevel error -y \
  -i mezz/216p.mp4 -i mezz/360p.mp4 -i mezz/540p.mp4 -i mezz/audio-en.mp4 -i mezz/audio-mn.mp4 \
  -map 0:v -map 1:v -map 2:v -map 3:a -map 4:a -c copy \
  -metadata:s:a:0 language=en -metadata:s:a:1 language=mn \
  -f dash -dash_segment_type mp4 -seg_duration 2 -use_template 1 -use_timeline 1 \
  -adaptation_sets "id=0,streams=0,1,2 id=1,streams=3 id=2,streams=4" \
  -init_seg_name 'init-$RepresentationID$.m4s' -media_seg_name 'chunk-$RepresentationID$-$Number%05d$.m4s' \
  dash/manifest.mpd
node - "$OUT/dash/manifest.mpd" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
let mpd = fs.readFileSync(file, 'utf8');
const text = ['en', 'mn'].map((lang, i) => `
		<AdaptationSet id="${10 + i}" contentType="text" mimeType="text/vtt" lang="${lang}">
			<Role schemeIdUri="urn:mpeg:dash:role:2011" value="subtitle"/>
			<Representation id="subs-${lang}" bandwidth="256">
				<BaseURL>../subs/${lang}.vtt</BaseURL>
			</Representation>
		</AdaptationSet>`).join('');
mpd = mpd.replace('</Period>', `${text}\n\t</Period>`);
// Label the audio adaptation sets so menus show readable names.
mpd = mpd.replace(/(<AdaptationSet id="1"[^>]*)>/, '$1>\n\t\t\t<Label>English</Label>');
mpd = mpd.replace(/(<AdaptationSet id="2"[^>]*)>/, '$1>\n\t\t\t<Label>Mongolian</Label>');
fs.writeFileSync(file, mpd);
NODE

echo "[fixtures] ClearKey-encrypted DASH (DEVELOPMENT/TESTING ONLY key)"
# Key id / key are public test values shared with scripts/fixture-server.mjs.
# The audio representation is encrypted ('cenc', full-sample AES-CTR) by
# scripts/cenc-encrypt.mjs; video stays clear (VP9 in CENC requires subsample
# encryption, which this fixture tool does not implement).
CK_KID=9eb4050de44b4802932e27d75083e266
CK_KEY=166634c675823c235a4a9446fad52e4d
mkdir -p dash-clearkey
ffmpeg -hide_banner -loglevel error -y -i mp4/vod-360p.mp4 -map 0:v -map 0:a -c copy \
  -f dash -dash_segment_type mp4 -seg_duration 2 -use_template 1 -use_timeline 1 \
  -adaptation_sets "id=0,streams=v id=1,streams=a" \
  -init_seg_name 'init-$RepresentationID$.m4s' -media_seg_name 'chunk-$RepresentationID$-$Number%05d$.m4s' \
  dash-clearkey/manifest.mpd
node "$ROOT/scripts/cenc-encrypt.mjs" "$OUT/dash-clearkey" 1 "$CK_KID" "$CK_KEY"
node - "$OUT/dash-clearkey/manifest.mpd" "$CK_KID" <<'NODE'
const fs = require('fs');
const [file, kid] = process.argv.slice(2);
const uuid = `${kid.slice(0, 8)}-${kid.slice(8, 12)}-${kid.slice(12, 16)}-${kid.slice(16, 20)}-${kid.slice(20)}`;
let mpd = fs.readFileSync(file, 'utf8');
mpd = mpd.replace('<MPD ', '<MPD xmlns:cenc="urn:mpeg:cenc:2013" ');
const protection = `
\t\t\t<ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" value="cenc" cenc:default_KID="${uuid}"/>
\t\t\t<ContentProtection schemeIdUri="urn:uuid:e2719d58-a985-b3c9-781a-b030af78d30e" value="ClearKey1.0"/>`;
mpd = mpd.replace(/(<AdaptationSet id="1"[^>]*>)/, `$1${protection}`);
fs.writeFileSync(file, mpd);
NODE

echo "[fixtures] error fixtures"
printf 'this is not a media file\n' > broken/not-a-video.mp4
printf '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nmissing/index.m3u8\n' > broken/missing-variant.m3u8
printf '<MPD this is not xml' > broken/malformed.mpd
printf 'garbage' > broken/unknown-extension.bin

echo "[fixtures] VAST fixtures"
cat > vast/inline-linear.xml <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<VAST version="3.0">
  <Ad id="rsp-fixture-linear">
    <InLine>
      <AdSystem>react-stream-player fixtures</AdSystem>
      <AdTitle>Fixture linear ad</AdTitle>
      <Impression><![CDATA[]]></Impression>
      <Creatives>
        <Creative id="c1">
          <Linear skipoffset="00:00:02">
            <Duration>00:00:06</Duration>
            <MediaFiles>
              <MediaFile delivery="progressive" type="video/mp4" width="640" height="360"><![CDATA[__ORIGIN__/fixtures/ads/ad-video.mp4]]></MediaFile>
            </MediaFiles>
          </Linear>
        </Creative>
      </Creatives>
    </InLine>
  </Ad>
</VAST>
XML
printf '<?xml version="1.0" encoding="UTF-8"?>\n<VAST version="3.0"></VAST>\n' > vast/no-fill.xml
printf '<?xml version="1.0"?><VAST version="3.0"><Ad><InLine>' > vast/malformed.xml

cat > generated.json <<JSON
{
  "codec": "${CODEC}",
  "videoCodec": "${VCODEC_STR}",
  "audioCodec": "${ACODEC_STR}",
  "durationSeconds": ${DURATION},
  "ffmpeg": "$(ffmpeg -version | head -1 | sed 's/"/\\"/g')"
}
JSON
rm -rf mezz
echo "[fixtures] done -> $OUT"
