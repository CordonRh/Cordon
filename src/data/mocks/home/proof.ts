
export const proofMock = {
  "badge": "protocol primitives",
  "title": {
    "before": "The details that make ",
    "accent": "privacy",
    "after": " useful."
  },
  "aside": "Independent claims, atomic execution, and explicit disclosure. The rules are part of the protocol.",
  "stats": [
    {
      "id": "volume",
      "label": "rights bundles",
      "value": "5",
      "caption": "claim types over one underlying asset",
      "visual": "sparkline",
      "trend": "independent, transferable rights",
      "quote": {
        "text": "Separate the dividend stream from the principal. Recombine the claims to recover the underlying.",
        "name": "Rights bundles",
        "role": "PRINCIPAL · INCOME · VOTE · REDEEM · CONTROL"
      }
    },
    {
      "id": "time-back",
      "label": "atomic DvP",
      "value": "16",
      "caption": "legs in a single atomic settlement",
      "visual": "hours",
      "trend": "all legs settle or none do",
      "quote": {
        "text": "Exchange assets, income claims, or baskets in a sealed batch with balanced totals.",
        "name": "Delivery versus payment",
        "role": "sealed batches · guarded oracle marks"
      }
    },
    {
      "id": "first-attempt",
      "label": "fee allocation",
      "value": "80%",
      "caption": "of servicing fees to protocol operators",
      "visual": "progress",
      "trend": "10% treasury, 5% stakers, 5% buyback and burn",
      "quote": {
        "text": "Publish the value of the portfolio while keeping its holdings confidential.",
        "name": "NAV attestation",
        "role": "epoch proofs · scoped view keys"
      }
    }
  ],
  "dimHours": 3
} as const;
export type ProofContent = typeof proofMock;
export type ProofStat = ProofContent["stats"][number];
