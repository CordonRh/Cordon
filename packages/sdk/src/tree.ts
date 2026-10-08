/** The pool's depth-32 note tree, rebuilt from the public `commitments` feed (leaf order). */
import { h2 } from "./hash";

export const DEPTH = 32;

export class NoteTree {
  private readonly zeros: bigint[] = [];
  private layers: bigint[][] = [[]];

  constructor(leaves: bigint[] = []) {
    let z = 0n;
    for (let i = 0; i < DEPTH; i++) {
      this.zeros.push(z);
      z = h2(z, z);
    }
    this.zeros.push(z);
    this.layers[0] = [...leaves];
    this.rebuild();
  }

  insert(leaf: bigint): number {
    this.layers[0].push(leaf);
    // Note: full rebuild per insert; update one path when trees get large.
    this.rebuild();
    return this.layers[0].length - 1;
  }

  get root(): bigint {
    return this.layers[DEPTH][0] ?? this.zeros[DEPTH];
  }

  indexOf(leaf: bigint): number {
    return this.layers[0].indexOf(leaf);
  }

  path(index: number): bigint[] {
    const out: bigint[] = [];
    for (let level = 0; level < DEPTH; level++) {
      out.push(this.layers[level][index ^ 1] ?? this.zeros[level]);
      index >>= 1;
    }
    return out;
  }

  private rebuild() {
    for (let level = 0; level < DEPTH; level++) {
      const cur = this.layers[level];
      const next: bigint[] = [];
      for (let i = 0; i < cur.length; i += 2) next.push(h2(cur[i], cur[i + 1] ?? this.zeros[level]));
      this.layers[level + 1] = next;
    }
  }
}
