/** 02 Hero — Figma 3488:21055. Copy is verbatim from the frame. */
export const heroMock = {
  chip: "confidential asset servicing",
  title: { before: "Your assets. Your ", accent: "rights", after: "." },
  subhead:
    "Split rights, secure claims, and settle atomically. Confidential asset servicing on Robinhood Chain.",
  actions: {
    primary: { label: "Open app", href: "/dashboard" },
    secondary: { label: "Explore the protocol", href: "#product" },
  },
  note: "confidential / provable / disclosable",
  /** The same note as the 1024 frame breaks it (3603:2158, 380 wide, 2 lines). */
  noteLines: ["confidential / provable /", "disclosable"],
  /** …and as the 390 frame breaks it (3893:2158, 217 wide, 12px, centred). */
  noteLines390: ["confidential / provable /", "disclosable"],
  window: {
    label: "Cordon servicing flow",
    title: "Asset servicing",
    meta: "5 rights / 1 bundle",
    status: "servicing flow",
    zoom: "100%",
    tools: [
      { name: "select", icon: "/assets/hero/hero-tool-select.svg" },
      { name: "add", icon: "/assets/hero/hero-tool-add.svg" },
      { name: "redirect", icon: "/assets/hero/hero-tool-redirect.svg" },
      { name: "code", icon: "/assets/hero/hero-tool-extra.svg" },
    ],
    trigger: { title: "Underlying deposited", source: "asset" },
    condition: { title: "Rights bundled", source: "condition" },
    log: { title: "Commit to ledger", source: "ledger" },
    /** Branch labels 3685:11 / 3685:13 on the Underlying deposited fan-out. */
    branches: { yes: "true", no: "else" },
    approval: { title: "Authorize settlement", source: "owner authorization" },
    wait: "26 min",
    runsLabel: "servicing sequence",
    runs: [
      {
        time: "09:41:02",
        name: "bundle claims",
        duration: "129 ms",
        live: true,
      },
      {
        time: "09:38:57",
        name: "NAV attestation",
        duration: "2.1 s",
        live: false,
      },
      {
        time: "09:31:14",
        name: "income accrual",
        duration: "410 ms",
        live: false,
      },
    ],
    /** Live feed — new rows reuse these in the Figma row format. */
    runPool: [
      { name: "bundle claims", duration: "134 ms" },
      { name: "income accrual", duration: "388 ms" },
      { name: "bundle claims", duration: "121 ms" },
      { name: "NAV attestation", duration: "1.9 s" },
      { name: "bundle claims", duration: "142 ms" },
      { name: "income accrual", duration: "402 ms" },
    ],
    /** Seconds between consecutive live-feed timestamps, cycled. */
    runGaps: [47, 73, 38, 91, 56],
  },
} as const;

export type HeroContent = typeof heroMock;
