#!/usr/bin/env bash
# Compiles every circuit and regenerates contracts/src/verifiers/*HonkVerifier.sol.
# Needs nargo + bb (run from WSL/Linux/macOS).
set -euo pipefail
cd "$(dirname "$0")"
# Toolchain of record: the verifiers and browser circuits must come from exactly these.
NARGO_VERSION="1.0.0-beta.22"
BB_VERSION="5.0.0-nightly.20260522"
[[ "$(nargo --version)" == *"nargo version = $NARGO_VERSION"* ]] || { echo "need nargo $NARGO_VERSION" >&2; exit 1; }
[ "$(bb --version)" = "$BB_VERSION" ] || [ "$(bb --version)" = "v$BB_VERSION" ] || { echo "need bb $BB_VERSION" >&2; exit 1; }
nargo compile --workspace
out=../contracts/src/verifiers
mkdir -p "$out"
for c in transfer bundle unbundle term income dvp order encumber unlock enforce nav; do
  name="$(tr '[:lower:]' '[:upper:]' <<<"${c:0:1}")${c:1}"
  mkdir -p "target/$c-vk"
  bb write_vk -b "target/$c.json" -o "target/$c-vk" -t evm >/dev/null
  bb write_solidity_verifier -k "target/$c-vk/vk" -o "target/$c-vk/Verifier.sol" -t evm >/dev/null
  sed -e "s/\bHonkVerificationKey\b/${name}VerificationKey/g" \
      -e "s/\bHonkVerifier\b/${name}HonkVerifier/g" \
      "target/$c-vk/Verifier.sol" > "$out/${name}HonkVerifier.sol"
done

# Browser copies for the SDK: bytecode + ABI only.
web=../public/circuits
mkdir -p "$web"
for c in transfer bundle unbundle term income dvp order encumber unlock enforce nav; do
  python3 -c "import json,sys; d=json.load(open('target/$c.json')); json.dump({k: d[k] for k in ('noir_version','hash','abi','bytecode')}, open('$web/$c.json','w'), separators=(',',':'))"
done
