import { createFileRoute } from "@tanstack/react-router";
import { CordonClient } from "@/components/cordon-client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Cordon — Confidential asset servicing" },
      {
        name: "description",
        content:
          "Confidential asset servicing. Rights bundles, encumbrances, atomic DvP settlement, corporate-action income, and provable NAV.",
      },
      { property: "og:title", content: "Cordon — Confidential asset servicing" },
      {
        property: "og:description",
        content:
          "Rights bundles, encumbrances, atomic DvP settlement, corporate-action income, and NAV attestation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CordonClient,
});
