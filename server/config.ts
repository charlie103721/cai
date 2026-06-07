type ImportMetaWithEnv = ImportMeta & {
  env?: {
    DEV?: boolean;
  };
};

const viteDev = (import.meta as ImportMetaWithEnv).env?.DEV;

// Vite sets import.meta.env.DEV at build time (true in dev, false in prod).
// For non-Vite contexts (tests, scripts), fall back to APP_STAGE.
export const isDev = viteDev
  ?? (typeof process !== "undefined" && process.env?.APP_STAGE === "dev");
