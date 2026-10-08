/** Client-side proving: noir_js witness + bb.js UltraHonk proof for the EVM verifiers. */
import { Barretenberg, UltraHonkBackend } from "@aztec/bb.js";
import { Noir, type CompiledCircuit, type InputMap } from "@noir-lang/noir_js";

export type CircuitName =
  | "transfer"
  | "bundle"
  | "unbundle"
  | "term"
  | "income"
  | "dvp"
  | "order"
  | "encumber"
  | "unlock"
  | "enforce"
  | "nav";

export type Proof = { proof: Uint8Array; publicInputs: `0x${string}`[] };

/** Loads `<base>/<circuit>.json` (the app serves them from /circuits). */
export type CircuitSource = (name: CircuitName) => Promise<CompiledCircuit>;

export const fetchCircuits =
  (base = "/circuits"): CircuitSource =>
  async (name) => {
    const res = await fetch(`${base}/${name}.json`);
    if (!res.ok) throw new Error(`circuit ${name}: ${res.status}`);
    return res.json();
  };

export class Prover {
  private api?: Promise<Barretenberg>;
  private readonly circuits = new Map<CircuitName, Promise<CompiledCircuit>>();

  constructor(private readonly source: CircuitSource) {}

  async prove(name: CircuitName, inputs: InputMap): Promise<Proof> {
    const circuit = await this.circuit(name);
    const { witness } = await new Noir(circuit).execute(inputs);
    this.api ??= Barretenberg.new();
    const backend = new UltraHonkBackend(circuit.bytecode, await this.api);
    const { proof, publicInputs } = await backend.generateProof(witness, { verifierTarget: "evm" });
    return { proof, publicInputs: publicInputs as `0x${string}`[] };
  }

  async verify(name: CircuitName, p: Proof): Promise<boolean> {
    const circuit = await this.circuit(name);
    this.api ??= Barretenberg.new();
    const backend = new UltraHonkBackend(circuit.bytecode, await this.api);
    return backend.verifyProof(p, { verifierTarget: "evm" });
  }

  private circuit(name: CircuitName) {
    let c = this.circuits.get(name);
    if (!c) this.circuits.set(name, (c = this.source(name)));
    return c;
  }
}

/** Bytes as 0x-prefixed hex. */
export const toHex = (b: Uint8Array): `0x${string}` =>
  `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
