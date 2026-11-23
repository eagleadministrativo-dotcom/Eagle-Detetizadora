import { defineConfig, devices } from "@playwright/test";

const port = process.env.E2E_PORT ?? "3200";
/** Ponta a ponta: celular (390 px) e computador (1440 px), nos temas claro e escuro. Requer `npm run build` antes. */
export default defineConfig({
  testDir: "e2e",
  snapshotPathTemplate: "e2e/__shots__/{projectName}/{arg}{ext}",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://localhost:${port}`, reducedMotion: "reduce", locale: "pt-BR", timezoneId: "America/Sao_Paulo", trace: "retain-on-failure" },
  webServer: { command: "node e2e/serve.mjs", url: `http://localhost:${port}/login`, timeout: 180_000, reuseExistingServer: !process.env.CI },
  projects: [
    { name: "celular-claro", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, colorScheme: "light" } },
    { name: "celular-escuro", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, colorScheme: "dark" } },
    { name: "computador-claro", use: { viewport: { width: 1440, height: 900 }, colorScheme: "light" } },
    { name: "computador-escuro", use: { viewport: { width: 1440, height: 900 }, colorScheme: "dark" } },
  ],
});
