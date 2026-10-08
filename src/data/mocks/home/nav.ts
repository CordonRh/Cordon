/**
 * 01 Navigation — Figma 3488:21037. Copy is verbatim from the frame; `code`
 * and `note` only feed the 390 menu card (not in Figma, design variant).
 */
export const navMock = {
  brand: { name: "Cordon", href: "/" },
  links: [
    {
      label: "Product",
      href: "#product",
      code: "PR",
      note: "Bundles, settlement, NAV",
    },
    {
      label: "How it works",
      href: "#scale",
      code: "HW",
      note: "From underlying to claims",
    },
    {
      label: "Protocol",
      href: "#proof",
      code: "CU",
      note: "Confidential by design",
    },
    {
      label: "Fees",
      href: "#pricing",
      code: "$",
      note: "Transparent servicing fees",
    },
  ],
  status: "confidential by design",
  cta: { label: "Open app", href: "/dashboard" },
} as const;

export type NavContent = typeof navMock;
