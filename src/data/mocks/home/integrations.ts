
export const integrationsMock = {
  "caption": "one shielded ledger, every part of your asset",
  "captionLines390": [
    "one shielded ledger,",
    "every part of your asset"
  ],
  "apps": [
    {
      "name": "principal",
      "initials": "PR",
      "active": false,
      "in1024": true,
      "in390": true
    },
    {
      "name": "income",
      "initials": "IN",
      "active": true,
      "in1024": true,
      "in390": true
    },
    {
      "name": "vote",
      "initials": "VO",
      "active": false,
      "in1024": true,
      "in390": true
    },
    {
      "name": "redeem",
      "initials": "RE",
      "active": false,
      "in1024": true,
      "in390": false
    },
    {
      "name": "control",
      "initials": "CO",
      "active": false,
      "in1024": false,
      "in390": true
    },
    {
      "name": "USDG",
      "initials": "$",
      "active": false,
      "in1024": false,
      "in390": false
    },
    {
      "name": "vaults",
      "initials": "VA",
      "active": false,
      "in1024": true,
      "in390": false
    },
    {
      "name": "builders",
      "initials": "SDK",
      "active": false,
      "in1024": true,
      "in390": false
    }
  ]
} as const;
export type IntegrationsContent = typeof integrationsMock;
export type IntegrationsApp = IntegrationsContent["apps"][number];
