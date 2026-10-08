
export const pricingMock = {
  "head": {
    "badge": "servicing fees",
    "title": {
      "before": "Pay for servicing. Keep ",
      "accent": "control",
      "after": "."
    },
    "aside": "Transparent protocol fees. 80% supports the operators who prove, relay and register; 10% the treasury; 5% stakers; 5% buys back and burns $CRDN."
  },
  "meter": {
    "eyebrow": "bundle fee calculator",
    "question": "What value would you like to bundle?",
    "resultEyebrow": "bundle / unbundle",
    "period": "at 10 bps",
    "included": "USDG of asset value",
    "cta": {
      "label": "Prepare a bundle",
      "href": "/dashboard/bundles"
    }
  },
  "tiers": [
    {
      "name": "Bundles",
      "price": "10",
      "runs": 3000,
      "period": "bps / operation",
      "featured": false,
      "features": [
        {
          "label": "Bundle or recombine claims",
          "size": "label"
        },
        {
          "label": "Five independent rights",
          "size": "label"
        },
        {
          "label": "No fee for splitting a claim",
          "size": "body"
        },
        {
          "label": "Retain control of your assets",
          "size": "label"
        }
      ],
      "cta": {
        "label": "Create a bundle",
        "href": "/dashboard/bundles"
      }
    },
    {
      "name": "Settlement",
      "price": "5",
      "runs": 30000,
      "period": "bps / leg",
      "featured": true,
      "tag": "atomic DvP",
      "features": [
        {
          "label": "Up to 16 settlement legs",
          "size": "body"
        },
        {
          "label": "All legs settle or none",
          "size": "body"
        },
        {
          "label": "Sealed 60-second batches",
          "size": "body"
        },
        {
          "label": "Oracle-guarded reference prices",
          "size": "body"
        }
      ],
      "cta": {
        "label": "Build a settlement",
        "href": "/dashboard/settlement"
      }
    },
    {
      "name": "Encumbrances",
      "price": "2",
      "runs": 300000,
      "period": "bps / year",
      "featured": false,
      "features": [
        {
          "label": "On encumbered asset value",
          "size": "body"
        },
        {
          "label": "Pledges, liens, and lockups",
          "size": "body"
        },
        {
          "label": "Claims stay in your ownership",
          "size": "body"
        },
        {
          "label": "Explicit release conditions",
          "size": "body"
        }
      ],
      "cta": {
        "label": "Manage collateral",
        "href": "/dashboard/encumbrances"
      }
    }
  ]
} as const;
export type PricingContent = typeof pricingMock;
