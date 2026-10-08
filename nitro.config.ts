import { defineConfig } from "nitro";

// The hosted DvP sequencer proves on the server. bb.js and noir_js load their wasm from
// their own package directories, so ship those packages whole instead of bundling them.
export default defineConfig({
  traceDeps: ["@aztec/bb.js*", "@noir-lang/noir_js*", "@noir-lang/acvm_js*", "@noir-lang/noirc_abi*", "@noir-lang/types*"],
});
