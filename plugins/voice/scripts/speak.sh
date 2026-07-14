#!/usr/bin/env bash
#
# speak.sh — say a short line aloud for the user.
#
# Interim engine: macOS `say`. Opt into vocli with SPEAK_ENGINE=vocli once vocli's
# real TTS lands (it currently emits placeholder audio, so `say` is the default).
#
# Usage:
#   speak.sh "text to speak"
#   echo "text to speak" | speak.sh
#
# Environment:
#   SPEAK_ENGINE  say (default) | vocli
#   SPEAK_VOICE   macOS `say` voice name (e.g. Samantha)        [say engine only]
#   SPEAK_RATE    macOS `say` words-per-minute (e.g. 180)       [say engine only]

set -eo pipefail

text="${1:-}"
if [ -z "$text" ]; then
  text="$(cat)"
fi

# Reject empty / whitespace-only input.
case "$text" in
  *[![:space:]]*) ;;
  *)
    echo "speak.sh: no text provided" >&2
    exit 1
    ;;
esac

engine="${SPEAK_ENGINE:-say}"

case "$engine" in
  vocli)
    if ! command -v vocli >/dev/null 2>&1; then
      echo "speak.sh: SPEAK_ENGINE=vocli but 'vocli' is not on PATH" >&2
      exit 1
    fi
    printf '%s' "$text" | vocli speak --sink speaker
    ;;
  say)
    if ! command -v say >/dev/null 2>&1; then
      echo "speak.sh: macOS 'say' not found (the interim engine is macOS-only)" >&2
      exit 1
    fi
    args=""
    [ -n "${SPEAK_VOICE:-}" ] && args="$args -v $SPEAK_VOICE"
    [ -n "${SPEAK_RATE:-}" ] && args="$args -r $SPEAK_RATE"
    # `say` reads the text from stdin when given no string argument, which avoids a
    # leading "-" in the text being parsed as a flag.
    # shellcheck disable=SC2086
    printf '%s' "$text" | say $args
    ;;
  *)
    echo "speak.sh: unknown SPEAK_ENGINE '$engine' (use 'say' or 'vocli')" >&2
    exit 1
    ;;
esac
