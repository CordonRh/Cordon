
export const footerMock = {
  "brand": {
    "name": "Cordon",
    "href": "/",
    "tagline": "Confidential asset servicing. Your rights, behind the cordon.",
    "socialLabel": "stay in touch",
    "socials": [
      {
        "label": "x",
        "name": "X",
        "href": "https://x.com/CordonRH"
      },
      {
        "label": "gh",
        "name": "GitHub",
        "href": "#github"
      },
      {
        "label": "tg",
        "name": "Telegram",
        "href": "#telegram"
      }
    ]
  },
  "cta": {
    "eyebrow": "your workspace",
    "title": {
      "before": "Put your assets to ",
      "accent": "work",
      "after": "."
    },
    "copy": "Start with a bundle. Keep the principal, direct the income, and manage every right in one place.",
    "emailLabel": "Name your workspace",
    "submit": "Open app"
  },
  "statuses": [
    {
      "label": "confidential by design",
      "short": "confidential by design"
    },
    {
      "label": "five claim types, one bundle",
      "short": "five rights, one bundle"
    },
    {
      "label": "public proofs, private holdings",
      "short": "provable and disclosable"
    }
  ],
  "company": {
    "name": "Cordon",
    "copy": "Confidential asset servicing for tokenized assets.",
    "compliance": "Rights bundles / Atomic settlement / Provable NAV"
  },
  "columns": [
    {
      "title": "product",
      "links": [
        {
          "label": "Rights bundles",
          "href": "/dashboard/bundles"
        },
        {
          "label": "Encumbrances",
          "href": "/dashboard/encumbrances"
        },
        {
          "label": "Settlement",
          "href": "/dashboard/settlement"
        },
        {
          "label": "Fees",
          "href": "#pricing"
        }
      ]
    },
    {
      "title": "resources",
      "links": [
        {
          "label": "Documentation",
          "href": "/docs"
        },
        {
          "label": "Architecture",
          "href": "/docs#architecture"
        },
        {
          "label": "Claim types",
          "href": "/docs#claims"
        },
        {
          "label": "NAV attestation",
          "href": "/docs#nav"
        }
      ]
    },
    {
      "title": "cordon",
      "links": [
        {
          "label": "About",
          "href": "/about"
        },
        {
          "label": "Protocol",
          "href": "#proof"
        },
        {
          "label": "Disclosure",
          "href": "/dashboard/disclosure"
        },
        {
          "label": "Workspace",
          "href": "/dashboard"
        }
      ]
    },
    {
      "title": "information",
      "links": [
        {
          "label": "Privacy",
          "href": "/privacy"
        },
        {
          "label": "Terms",
          "href": "/terms"
        },
        {
          "label": "Cookies",
          "href": "/cookies"
        }
      ]
    }
  ],
  "legal": {
    "copyright": "© 2026 Cordon. All rights reserved.",
    "origin": "confidential. provable. disclosable."
  }
} as const;
export type FooterContent = typeof footerMock;
