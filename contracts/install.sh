#!/usr/bin/env bash
# Fetches the Solidity dependencies into contracts/lib (not committed), pinned to commits:
#   forge-std v1.16.2, OpenZeppelin Contracts v5.4.0, poseidon2-evm (zemse) main@35c0707.
set -euo pipefail
cd "$(dirname "$0")"
forge install --no-git \
  foundry-rs/forge-std@bf647bd6046f2f7da30d0c2bf435e5c76a780c1b \
  OpenZeppelin/openzeppelin-contracts@c64a1edb67b6e3f4a15cca8909c9482ad33a02b0 \
  zemse/poseidon2-evm@35c07075805b35368c13044cae8ec3d1a0b59209
