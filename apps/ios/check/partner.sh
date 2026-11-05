#!/bin/sh
# The partner window's recipe and child-phone rules on a Mac (no simulator): the same Swift files the app ships.
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cp "$here/partner.swift" "$tmp/main.swift" # top-level code: swiftc runs it only as main.swift
swiftc -O -enable-bare-slash-regex "$repo/apps/ios/ZeroFee/PartnerRecipe.swift" "$repo/apps/ios/ZeroFee/ChildPhone.swift" "$repo/apps/ios/ZeroFee/HostRules.swift" "$repo/apps/ios/ZeroFee/PinnedRecipes.swift" "$repo/apps/ios/ZeroFee/TorControl.swift" "$repo/apps/ios/ZeroFee/WarmRules.swift" "$repo/apps/ios/ZeroFee/Places.swift" "$repo/apps/ios/ZeroFee/TabRules.swift" "$repo/apps/ios/ZeroFee/TrackerRules.swift" "$repo/apps/ios/ZeroFee/PhishGuard.swift" "$repo/apps/ios/ZeroFee/EverySite.swift" "$repo/apps/ios/ZeroFee/PartnerSeedGuard.swift" "$repo/apps/ios/ZeroFee/PartnerNotices.swift" "$tmp/main.swift" -o "$tmp/check"
"$tmp/check" "$repo"
