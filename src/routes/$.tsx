import { createFileRoute } from "@tanstack/react-router";
import { CordonClient } from "@/components/cordon-client";

export const Route = createFileRoute("/$")({
  head: () => ({
    meta: [
      { title: "Cordon — Workspace" },
      {
        name: "description",
        content:
          "Cordon workspace: rights bundles, encumbrances, settlement requests, income, and NAV attestation.",
      },
      { property: "og:title", content: "Cordon — Workspace" },
      {
        property: "og:description",
        content:
          "Cordon workspace: rights bundles, encumbrances, settlement requests, income, and NAV attestation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CordonClient,
});
