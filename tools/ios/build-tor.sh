#!/bin/sh
# Builds apps/ios/ZeroFee/Tor.xcframework (D130/D131: the Browser's Private browsing) from tor, OpenSSL and libevent's own
# signed source releases, pinned in tools/ios/tor-sources.txt. Nothing prebuilt is used: no Tor.framework binary, no
# Homebrew library. It fails closed: a tarball whose sha256 isn't the pin, or whose signature isn't good from one of the
# pinned keys (tools/ios/tor-keys/), stops the build before anything is unpacked.
#
#   sh tools/ios/build-tor.sh            # about 10-20 minutes on a Mac; needs Xcode and gpg (Homebrew's gnupg)
#
# The output is static: per slice (iPhone arm64, Simulator arm64) one libTor.a holding libtor, libevent, libssl and
# libcrypto, with tor's tor_api.h as the module `Tor` (it links the system zlib by itself). It sits in the Xcode project's
# synced folder, so Xcode links it with no project-file change. apps/ios/ZeroFee/Tor.xcframework is gitignored: anyone
# rebuilds the same thing from the pins. tor is built with no lzma, no zstd, no relay and no directory-authority code.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
pins="$here/tor-sources.txt"
out="$repo/apps/ios/ZeroFee/Tor.xcframework"
work="${TOR_BUILD_DIR:-${TMPDIR:-/tmp}/zerofee-tor-build}"
min_ios=17.0
jobs="${TOR_BUILD_JOBS:-4}"

GPG="$(command -v gpg || true)"
[ -n "$GPG" ] || GPG=/opt/homebrew/bin/gpg
[ -x "$GPG" ] || { echo "build-tor: gpg isn't installed (brew install gnupg). Nothing was built." >&2; exit 1; }
command -v xcrun >/dev/null || { echo "build-tor: Xcode's command-line tools are missing." >&2; exit 1; }

rm -rf "$work"
mkdir -p "$work/dl" "$work/src"
# A throwaway keyring with only the pinned keys (a short path: gpg's socket path has a length limit; no agent needed).
GNUPGHOME="$(mktemp -d /tmp/zf-torgpg.XXXXXX)"
export GNUPGHOME
chmod 700 "$GNUPGHOME"
trap 'rm -rf "$GNUPGHOME"' EXIT
"$GPG" --batch --quiet --no-autostart --import "$here"/tor-keys/*.asc 2>/dev/null || true
for k in $(grep -Ev '^(#|$)' "$pins" | cut -d'|' -f7); do
  "$GPG" --batch --no-autostart --list-keys "$k" >/dev/null 2>&1 || { echo "build-tor: pinned key $k isn't in tools/ios/tor-keys/. Stopped." >&2; exit 1; }
done

# ── 1. Download, pin, verify ───────────────────────────────────────────────────────────────────────────────────────────
verify() { # name version url sigurl signed sha keys
  name=$1 url=$3 sigurl=$4 signed=$5 sha=$6 keys=$7
  file="$work/dl/$(basename "$url")"
  sig="$work/dl/$(basename "$sigurl")"
  curl -fsSL --proto '=https' --tlsv1.2 -o "$file" "$url"
  curl -fsSL --proto '=https' --tlsv1.2 -o "$sig" "$sigurl"
  got="$(shasum -a 256 "$file" | cut -d' ' -f1)"
  [ "$got" = "$sha" ] || { echo "build-tor: $name's sha256 is $got, not the pinned $sha. Stopped." >&2; exit 1; }
  if [ "$signed" = sha256sum ]; then
    # tor signs a one-line sha256sum file: it must name this tarball with the pinned hash.
    sums="$work/dl/$(basename "$url").sha256sum"
    curl -fsSL --proto '=https' --tlsv1.2 -o "$sums" "$url.sha256sum"
    [ "$(cut -d' ' -f1 "$sums")" = "$sha" ] || { echo "build-tor: $name's signed sha256sum doesn't match the pin. Stopped." >&2; exit 1; }
    target="$sums"
  else
    target="$file"
  fi
  # A good signature from a pinned primary key: VALIDSIG's last field is the primary key's fingerprint.
  status="$("$GPG" --batch --no-autostart --status-fd 1 --verify "$sig" "$target" 2>/dev/null || true)"
  # A bad signature or a revoked key stops it. It needs at least one good signature whose primary key is pinned for this
  # source and was live WHEN it signed: a key that has expired since counts (OpenSSL's BA54 key, expired 2026-09-08, signed
  # 3.5.7 on 2026-06-09); a signature made after its key expired doesn't, nor does an unpinned signer.
  if printf '%s\n' "$status" | grep -qE '^\[GNUPG:\] (BADSIG|REVKEYSIG)'; then
    echo "build-tor: $name has a bad signature, or one from a revoked key. Stopped." >&2; exit 1
  fi
  ok=no
  for fpr in $(printf '%s\n' "$status" | awk '$2 == "NEWSIG" { good = 0; expd = 0; till = 0 } $2 == "KEYEXPIRED" && $3 + 0 > till { till = $3 + 0 } $2 == "GOODSIG" { good = 1 } $2 == "EXPKEYSIG" { expd = 1 } $2 == "VALIDSIG" && (good || (expd && $5 + 0 < till)) { print $NF }'); do
    for k in $keys; do [ "$fpr" = "$k" ] && ok=yes; done
  done
  [ "$ok" = yes ] || { echo "build-tor: $name isn't signed by a pinned key. Stopped." >&2; exit 1; }
  echo "build-tor: $name $2: sha256 and signature good"
  tar -xzf "$file" -C "$work/src"
}
while IFS='|' read -r name version url sigurl signed sha keys; do
  case "$name" in ''|'#'*) continue ;; esac
  verify "$name" "$version" "$url" "$sigurl" "$signed" "$sha" "$keys"
  eval "ver_$name=\$version"
done < "$pins"
openssl_src="$work/src/openssl-$ver_openssl"
libevent_src="$work/src/libevent-$ver_libevent"
tor_src="$work/src/tor-$ver_tor"

# ── 2. Build each slice ────────────────────────────────────────────────────────────────────────────────────────────────
swap_ok() { # stop if the Mac is swapping hard (the machine gate: swap ≥ 6 GB)
  used="$(sysctl -n vm.swapusage | sed -E 's/.*used = ([0-9.]+)M.*/\1/')"
  [ "$(printf '%.0f' "$used")" -lt 6144 ] || { echo "build-tor: swap is at ${used} MB. Stopped to spare the Mac." >&2; exit 1; }
}

slice() { # sdk triple openssl-target
  sdk=$1 triple=$2 ossl=$3
  pre="$work/build/$sdk"
  rm -rf "$pre"; mkdir -p "$pre"
  sysroot="$(xcrun --sdk "$sdk" --show-sdk-path)"
  cc="$(xcrun --sdk "$sdk" --find clang)"
  cflags="-target $triple -isysroot $sysroot -O2"
  export AR="$(xcrun --sdk "$sdk" --find ar)" RANLIB="$(xcrun --sdk "$sdk" --find ranlib)"

  swap_ok
  b="$work/obj/$sdk/openssl"; rm -rf "$b"; mkdir -p "$b"; cp -Rp "$openssl_src/." "$b"
  (cd "$b" && CC="$cc" CFLAGS="$cflags" ./Configure "$ossl" no-shared no-tests no-apps no-docs no-dso no-engine no-ui-console \
     no-comp no-async --prefix="$pre" --openssldir="$pre/ssl" >/dev/null && make -j"$jobs" build_libs >/dev/null && make install_dev >/dev/null)

  swap_ok
  b="$work/obj/$sdk/libevent"; rm -rf "$b"; mkdir -p "$b"; cp -Rp "$libevent_src/." "$b"
  (cd "$b" && CC="$cc" CFLAGS="$cflags" ./configure --host=aarch64-apple-ios --build="$(uname -m | sed s/arm64/aarch64/)-apple-darwin" --prefix="$pre" --disable-shared --enable-static \
     --disable-openssl --disable-samples --disable-libevent-regress --disable-debug-mode --disable-dependency-tracking >/dev/null \
     && make -j"$jobs" >/dev/null && make install >/dev/null)

  swap_ok
  b="$work/obj/$sdk/tor"; rm -rf "$b"; mkdir -p "$b"; cp -Rp "$tor_src/." "$b"
  (cd "$b" && CC="$cc" CFLAGS="$cflags" CPPFLAGS="-I$pre/include" LDFLAGS="-L$pre/lib" ./configure --host=aarch64-apple-ios --build="$(uname -m | sed s/arm64/aarch64/)-apple-darwin" \
     --prefix="$pre" --disable-lzma --disable-zstd --disable-module-relay --disable-module-dirauth --disable-asciidoc \
     --disable-manpage --disable-html-manual --disable-system-torrc --disable-unittests --disable-tool-name-check \
     --disable-seccomp --disable-libscrypt --disable-dependency-tracking \
     --enable-static-openssl --with-openssl-dir="$pre" --enable-static-libevent --with-libevent-dir="$pre" >/dev/null \
     && make -j"$jobs" libtor.a >/dev/null)

  # One static library per slice, and the one public header.
  libtool -static -no_warning_for_no_symbols -o "$pre/libTor.a" "$b/libtor.a" "$pre/lib/libevent.a" "$pre/lib/libssl.a" "$pre/lib/libcrypto.a"
  mkdir -p "$pre/headers"
  cp "$b/src/feature/api/tor_api.h" "$pre/headers/"
  printf 'module Tor {\n  header "tor_api.h"\n  link "z"\n  export *\n}\n' > "$pre/headers/module.modulemap"
}
slice iphoneos "arm64-apple-ios$min_ios" ios64-xcrun
slice iphonesimulator "arm64-apple-ios$min_ios-simulator" iossimulator-arm64-xcrun

# ── 3. The xcframework ─────────────────────────────────────────────────────────────────────────────────────────────────
rm -rf "$out"
xcodebuild -create-xcframework \
  -library "$work/build/iphoneos/libTor.a" -headers "$work/build/iphoneos/headers" \
  -library "$work/build/iphonesimulator/libTor.a" -headers "$work/build/iphonesimulator/headers" \
  -output "$out" >/dev/null
for sym in _tor_run_main _tor_main_configuration_new _tor_main_configuration_setup_control_socket _tor_main_configuration_set_command_line _tor_main_configuration_free; do
  nm -g "$work/build/iphoneos/libTor.a" 2>/dev/null | grep -q " T $sym\$" || { echo "build-tor: $sym is missing from libTor.a." >&2; exit 1; }
done
# The pins this was built from: build-web.sh rebuilds when tor-sources.txt changes (review L: an old tor never survives).
shasum -a 256 "$here/tor-sources.txt" | cut -d' ' -f1 > "$out/zf-pins.sha256"
echo "build-tor: tor $ver_tor, OpenSSL $ver_openssl, libevent $ver_libevent -> ${out#"$repo"/} ($(du -sh "$out" | cut -f1))"
