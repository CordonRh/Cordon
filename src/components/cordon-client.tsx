import { lazy, Suspense } from "react";
import { ClientOnly } from "@tanstack/react-router";

const App = lazy(() => import("@/App").then((m) => ({ default: m.App })));

export function CordonClient() {
  return (
    <ClientOnly fallback={null}>
      <Suspense fallback={null}>
        <App />
      </Suspense>
    </ClientOnly>
  );
}
