
export const statementMock = {
  "kicker": "[ confidential. provable. disclosable. ]",
  "title": {
    "lead": "Sell the income. Keep the asset.",
    "accent": "Keep your privacy",
    "tail": "."
  },
  "caption": "one ledger, every right",
  "now": "now",
  "hours": [
    "09:00",
    "11:00",
    "13:00",
    "15:00",
    "17:00",
    "19:00"
  ]
} as const;
export type StatementContent = typeof statementMock;
