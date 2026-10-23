#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_directory="$repository_root/build/ios"
derived_data="$repository_root/build/DerivedData"

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf '%s\n' 'This build requires macOS with the full Xcode app installed.' >&2
  exit 1
fi
if ! command -v xcodebuild >/dev/null 2>&1; then
  printf '%s\n' 'xcodebuild is missing. Install Xcode and select it with xcode-select.' >&2
  exit 1
fi

cd "$repository_root"
xcodebuild -version
xcodebuild \
  -project "$repository_root/MealCompare.xcodeproj" \
  -scheme MealCompare \
  -configuration Release \
  -sdk iphoneos \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$derived_data" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY= \
  build

application_path="$derived_data/Build/Products/Release-iphoneos/MealCompare.app"
if [[ ! -d "$application_path" ]]; then
  printf '%s\n' 'The build did not produce MealCompare.app.' >&2
  exit 1
fi

# Only replace generated output at this fixed repository-local path.
mkdir -p "$output_directory"
rm -rf "$repository_root/build/ios/Payload"
mkdir -p "$output_directory/Payload"
ditto --noextattr --noqtn "$application_path" "$output_directory/Payload/MealCompare.app"

ipa_path="$output_directory/MealCompare-unsigned.ipa"
rm -f "$ipa_path"
ditto -c -k --sequesterRsrc --keepParent "$output_directory/Payload" "$ipa_path"
unzip -tq "$ipa_path"
printf '\nUnsigned app: %s\nUnsigned IPA: %s\n' "$output_directory/Payload/MealCompare.app" "$ipa_path"
printf '%s\n' 'This IPA must be signed for your device before installation. No signing credentials were used.'
