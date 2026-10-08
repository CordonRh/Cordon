
export const productMock = {
  "head": {
    "badge": "asset servicing",
    "title": {
      "before": "One asset. Every ",
      "accent": "possibility",
      "after": "."
    },
    "aside": "Separate the rights. Keep the underlying. Cordon brings confidential claims, collateral, and settlement into one shielded ledger."
  },
  "trace": {
    "index": "01",
    "title": "One bundle, five independent rights",
    "body": "PRINCIPAL, INCOME, VOTE, REDEEM, CONTROL. Transfer or pledge claims independently, then recombine to withdraw.",
    "run": "bundle lifecycle",
    "summary": "one underlying, five claims",
    "steps": [
      {
        "label": "underlying note",
        "value": "deposit",
        "done": true
      },
      {
        "label": "screening gate",
        "value": "15 min",
        "done": true
      },
      {
        "label": "bundle proof",
        "value": "5 claims",
        "done": true
      },
      {
        "label": "owner approval",
        "value": "sign",
        "done": false
      }
    ],
    "axis": [
      "0",
      "50",
      "100",
      "150",
      "200 ms"
    ]
  },
  "approval": {
    "index": "02",
    "title": "Your claims. Your permission.",
    "body": "Pledge, lock, or attach a lien without exposing your holdings. A counterparty verifies the obligation, not your entire portfolio.",
    "channel": "claim authorization",
    "day": "today",
    "sender": "Cordon",
    "time": "9:41",
    "message": "Create a time-bound INCOME claim and retain the underlying PRINCIPAL.",
    "fields": [
      {
        "key": "claim",
        "value": "INCOME"
      },
      {
        "key": "term",
        "value": "12 months"
      },
      {
        "key": "owner",
        "value": "selective disclosure"
      }
    ],
    "approve": "Review",
    "hold": "Details",
    "waiting": "owner approval"
  },
  "chart": {
    "index": "03",
    "title": "Prove the value. Keep the holdings.",
    "body": "Epoch NAV attestations prove a basket’s value without publishing its composition. Share a view key when disclosure is needed.",
    "caption": "NAV attestation epochs",
    "average": "hourly or daily",
    "days": [
      "mon",
      "tue",
      "wed",
      "thu",
      "fri",
      "sat"
    ]
  }
} as const;
export type ProductContent = typeof productMock;
