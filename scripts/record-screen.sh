#!/usr/bin/env bash
#
# record-screen.sh — Option 2: manual full-framerate screen capture (ffmpeg x11grab).
#
# You drive the browser yourself; this records whatever is on screen. Press 'q'
# (or Ctrl-C) in this terminal to stop. Hardware-encoded via NVENC by default so
# 4K/60 capture barely touches the CPU.
#
# Usage:
#   scripts/record-screen.sh                 # full screen, 60fps → recordings/screen-<ts>.mp4
#   scripts/record-screen.sh 1920x1080       # top-left 1920x1080 region
#   scripts/record-screen.sh 1280x720+100+80 # 1280x720 region at offset +100,+80
#
# Env overrides:
#   FPS=30            capture framerate (default 60)
#   DISP=:1.0         X display to grab (default :1.0)
#   ENCODER=x264      software encode instead of nvenc (default nvenc)
#   AUDIO=1           also capture desktop audio via PulseAudio (default off)
#   OUT=path.mp4      explicit output path
#
set -euo pipefail

cd "$(dirname "$0")/.."

FPS="${FPS:-60}"
DISP="${DISP:-:1.0}"
ENCODER="${ENCODER:-nvenc}"
AUDIO="${AUDIO:-0}"

# --- resolve capture geometry -------------------------------------------------
GEOM="${1:-}"
SCREEN_DIM="$(xdpyinfo -display "${DISP%.*}" 2>/dev/null | awk '/dimensions:/ {print $2}')"
SCREEN_DIM="${SCREEN_DIM:-3840x2160}"

if [[ -z "$GEOM" ]]; then
  SIZE="$SCREEN_DIM"
  OFFSET=""
elif [[ "$GEOM" == *"+"* ]]; then
  SIZE="${GEOM%%+*}"
  OFFSET="+${GEOM#*+}"          # e.g. +100+80
else
  SIZE="$GEOM"
  OFFSET="+0+0"
fi
INPUT="${DISP}${OFFSET}"

# --- resolve output path ------------------------------------------------------
mkdir -p recordings
TS="$(date +%Y-%m-%dT%H-%M-%S)"
OUT="${OUT:-recordings/screen-${TS}.mp4}"

# --- encoder args -------------------------------------------------------------
# Capture the encoder list first — piping straight into `grep -q` trips
# `set -o pipefail` (grep closes the pipe on match, ffmpeg dies on SIGPIPE).
ENC_LIST="$(ffmpeg -hide_banner -encoders 2>/dev/null || true)"
if [[ "$ENCODER" == "nvenc" ]] && grep -q h264_nvenc <<<"$ENC_LIST"; then
  VCODEC=(-c:v h264_nvenc -preset p5 -tune hq -cq 20 -pix_fmt yuv420p)
  ENCNAME="h264_nvenc"
else
  VCODEC=(-c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p)
  ENCNAME="libx264"
fi

# --- optional desktop audio ---------------------------------------------------
AUDIO_IN=()
AUDIO_CODEC=()
if [[ "$AUDIO" == "1" ]]; then
  AUDIO_IN=(-f pulse -i default)
  AUDIO_CODEC=(-c:a aac -b:a 192k)
fi

cat <<EOF

  ┌─ Screen recording ────────────────────────────────
  │ display : ${INPUT}
  │ size    : ${SIZE} @ ${FPS}fps
  │ encoder : ${ENCNAME}$( [[ "$AUDIO" == "1" ]] && echo "  (+ desktop audio)" )
  │ output  : ${OUT}
  ├────────────────────────────────────────────────────
  │ Recording starts in 3s. Switch to your browser now.
  │ Press  q  (or Ctrl-C) here to STOP.
  └────────────────────────────────────────────────────
EOF
sleep 3

exec ffmpeg -hide_banner \
  -f x11grab -framerate "$FPS" -video_size "$SIZE" -draw_mouse 1 -i "$INPUT" \
  "${AUDIO_IN[@]}" \
  "${VCODEC[@]}" "${AUDIO_CODEC[@]}" \
  -movflags +faststart \
  "$OUT"
