#!/usr/bin/env bash
# Installs the Chinese fonts of Ubuntu's fonts-noto-cjk for the CI browser suites, normally without apt.
# The same Noto CJK files are taken from pinned upstream tags (NOTO_CJK_SANS, NOTO_CJK_SERIF) and checked
# against NOTO_CJK_SHA256 ("sha256  file" per line); they are installed where the package puts them, with
# the package's fontconfig rule, so text measures the same as with apt. A restored cache (CACHE_HIT=true in
# FONT_CACHE_DIR) is checked the same way. Only when download or check fails is apt used, with short
# timeouts. Every stage's duration is printed and reported in a notice annotation, so a slow run shows
# where it stalled. FONT_ROOT installs under another root for local checks (no sudo, no fc-cache of /).
set -uo pipefail

: "${NOTO_CJK_SANS:?}" "${NOTO_CJK_SERIF:?}" "${NOTO_CJK_SHA256:?}"
cache_dir=${FONT_CACHE_DIR:-$HOME/.cache/noto-cjk}
root=${FONT_ROOT:-}
font_dir=$root/usr/share/fonts/opentype/noto
conf_avail=$root/usr/share/fontconfig/conf.avail
conf_d=$root/etc/fonts/conf.d
sudo=sudo
if [ -n "$root" ] || [ "$(id -u)" = 0 ]; then sudo=; fi
manifest=$(printf '%s\n' "$NOTO_CJK_SHA256" | grep -v '^[[:space:]]*$')
files=$(printf '%s\n' "$manifest" | awk '{ print $2 }')

timings=()
started=$(date +%s.%N)
elapsed() { awk -v a="$1" -v b="$(date +%s.%N)" 'BEGIN { printf "%.1fs", b - a }'; }
# stage NAME COMMAND...: runs the command and records how long it took.
stage() {
  local name=$1 start status
  shift
  echo "[fonts] $name ..."
  start=$(date +%s.%N)
  "$@"
  status=$?
  timings+=("$name=$(elapsed "$start")")
  echo "[fonts] $name: ${timings[-1]#*=}, exit $status"
  return "$status"
}

download() {
  local file tag dir args=()
  mkdir -p "$cache_dir"
  for file in $files; do
    case $file in NotoSans*) tag=$NOTO_CJK_SANS dir=Sans ;; *) tag=$NOTO_CJK_SERIF dir=Serif ;; esac
    args+=(-o "$cache_dir/$file" "https://raw.githubusercontent.com/notofonts/noto-cjk/$tag/$dir/OTC/$file")
  done
  # A stalled connection (under 100 KB/s for 15 s) counts as an error and is retried; the whole download is
  # bounded so a bad network falls back to apt in time.
  timeout 150 curl --parallel --fail --silent --show-error --location \
    --retry 3 --retry-all-errors --connect-timeout 10 --max-time 60 --speed-limit 102400 --speed-time 15 "${args[@]}"
}

verify() { (cd "$cache_dir" && printf '%s\n' "$manifest" | sha256sum --check --strict --quiet); }

# The fontconfig rule shipped by fonts-noto-cjk (70-fonts-noto-cjk.conf), byte for byte.
noto_conf() {
  local generic font lang first=1
  printf '<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n'
  for generic in serif sans-serif monospace; do
    case $generic in serif) font='Noto Serif CJK' ;; sans-serif) font='Noto Sans CJK' ;; *) font='Noto Sans Mono CJK' ;; esac
    for lang in ja ko zh-cn zh-tw zh-hk; do
      [ "$first" ] || printf '\n'
      first=
      printf '    <match target="pattern">\n'
      printf '        <test name="lang">\n            <string>%s</string>\n        </test>\n' "$lang"
      printf '        <test name="family">\n            <string>%s</string>\n        </test>\n' "$generic"
      case $lang in zh-*) printf '        <edit name="family" mode="prepend" binding="strong">\n' ;; *) printf '        <edit name="family" mode="prepend">\n' ;; esac
      printf '            <string>%s %s</string>\n        </edit>\n    </match>\n' "$font" "$(printf '%s' "${lang#zh-}" | tr a-z A-Z | sed 's/^JA$/JP/; s/^KO$/KR/; s/^CN$/SC/; s/^TW$/TC/')"
    done
  done
  printf '</fontconfig>\n'
}

install_files() {
  local file
  $sudo install -d "$font_dir" "$conf_avail" "$conf_d" || return
  for file in $files; do $sudo install -m 644 "$cache_dir/$file" "$font_dir/" || return; done
  noto_conf | $sudo tee "$conf_avail/70-fonts-noto-cjk.conf" > /dev/null || return
  $sudo ln -sf "$conf_avail/70-fonts-noto-cjk.conf" "$conf_d/70-fonts-noto-cjk.conf"
}

apt_install() {
  local attempt opts=(-o Acquire::Retries=3 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 -o DPkg::Lock::Timeout=30)
  for attempt in 1 2; do
    stage "apt-update#$attempt" $sudo timeout 90 apt-get "${opts[@]}" update &&
      stage "apt-install#$attempt" $sudo timeout 150 apt-get "${opts[@]}" install -y --no-install-recommends fonts-noto-cjk &&
      return 0
  done
  return 1
}

source=
if [ "${CACHE_HIT:-}" = true ] && stage verify-cache verify; then
  source=cache
elif stage download download && stage verify verify; then
  source=download
fi
if [ -n "$source" ] && ! { stage install install_files && stage fc-cache $sudo fc-cache -f "$font_dir"; }; then
  source=
fi
if [ -z "$source" ]; then
  # Nothing unverified may be saved to the cache.
  rm -rf "$cache_dir"
  echo "::warning title=Chinese fonts::Pinned Noto CJK download or check failed; falling back to apt"
  apt_install && source=apt
fi

families=$(fc-list :lang=zh family | wc -l)
# Unescaped, fontconfig reads "-serif" as a size suffix and matches the family "sans".
sans=$(fc-match -f '%{family[0]}' 'sans\-serif:lang=zh-cn')
summary="source=${source:-none} ${timings[*]} total=$(elapsed "$started") zh-fonts=$families sans-serif:zh-cn=$sans"
echo "::notice title=Chinese fonts::$summary"
echo "source=$source" >> "${GITHUB_OUTPUT:-/dev/null}"
if [ "$families" -eq 0 ]; then echo '::error title=Chinese fonts::No Chinese font installed'; exit 1; fi
if [ "$sans" != 'Noto Sans CJK SC' ]; then echo "::error title=Chinese fonts::sans-serif for zh-cn is $sans, not Noto Sans CJK SC"; exit 1; fi
