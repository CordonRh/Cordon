
export const scaleMock = {
  "head": {
    "badge": "protocol architecture",
    "title": {
      "before": "",
      "accent": "Private",
      "after": " by design. Provable by default."
    },
    "aside": "A shielded ledger, typed claims, and atomic settlement. Verification is public. Your holdings remain yours."
  },
  "runtime": {
    "title": "Five modules. One ledger.",
    "copy": "Rights bundles, encumbrances, atomic DvP, corporate actions, and NAV attestation share the same confidential note model.",
    "label": "one ledger, every servicing action",
    "caption": "bundles, collateral, settlement, NAV",
    "apps": [
      {
        "code": "RB",
        "name": "bundles"
      },
      {
        "code": "EN",
        "name": "encumbrances"
      },
      {
        "code": "DV",
        "name": "settlement"
      },
      {
        "code": "NV",
        "name": "NAV"
      }
    ]
  },
  "regions": {
    "title": "The right disclosure, to the right person",
    "copy": "Scope access to a claim, bundle, or portfolio. Investors verify proofs; authorized reviewers receive only the view they need.",
    "label": "three scopes of selective disclosure",
    "rows": [
      {
        "region": "claim",
        "city": "A single right",
        "share": "1"
      },
      {
        "region": "bundle",
        "city": "Related claims",
        "share": "5"
      },
      {
        "region": "portfolio",
        "city": "Full position view",
        "share": "all"
      }
    ],
    "footnote": "confidential by default; disclosed by permission"
  }
} as const;
export type ScaleContent = typeof scaleMock;
