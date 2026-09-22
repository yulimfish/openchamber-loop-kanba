import { applyHostReady } from "@openchamber/sdk/ui";

import { createHostAdapter, type HostAdapter } from "../src/host-adapter";

export const bootstrapPanel = async (host: HostAdapter) => {
  let disposed = false;
  const disposeReady = host.onReady((context) => {
    applyHostReady(context, document.documentElement);
    document.documentElement.lang = context.locale;
  });
  let disposeProjects: (() => void) | undefined;

  try {
    disposeProjects = await host.onProjects(() => undefined);
  } catch (error) {
    disposeReady();
    host.dispose();
    throw error;
  }

  return () => {
    if (disposed) return;
    disposed = true;
    disposeReady();
    disposeProjects?.();
    host.dispose();
  };
};

if (typeof window !== "undefined" && typeof document !== "undefined") {
  void (async () => {
    const dispose = await bootstrapPanel(createHostAdapter());
    window.addEventListener("beforeunload", dispose, { once: true });
  })();
}
