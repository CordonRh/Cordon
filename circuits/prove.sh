#!/usr/bin/env bash
# Proves one circuit for the Foundry tests (vm.ffi) and the SDK fallback.
# usage: prove.sh <circuit> <id>   with inputs in circuits/<circuit>/<id>.toml
# stdout: abi.encode(bytes proof, bytes32[] publicInputs)
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.foundry/bin:$HOME/.nargo/bin:$HOME/.bb:$PATH"
c=$1
id=$2
dir="target/$id"
cleanup() { rm -rf "$dir" "target/$id.gz" "$c/$id.toml"; }
trap cleanup EXIT
(cd "$c" && nargo execute -p "$id" "$id" >/dev/null 2>"../target/$id.err") || { cat "target/$id.err" >&2; rm -f "target/$id.err"; exit 1; }
rm -f "target/$id.err"
mkdir -p "$dir"
bb prove -b "target/$c.json" -w "target/$id.gz" -k "target/$c-vk/vk" -o "$dir" -t evm >/dev/null 2>&1
proof="0x$(od -An -v -tx1 "$dir/proof" | tr -d ' \n')"
pubs="$(od -An -v -tx1 "$dir/public_inputs" | tr -d ' \n' | fold -w64 | sed 's/^/0x/' | paste -sd, -)"
cast abi-encode "f(bytes,bytes32[])" "$proof" "[$pubs]"
