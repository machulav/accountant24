import { describe, expect, it } from "vitest";
import { homeStructuredData } from "../structured-data";

describe("homeStructuredData()", () => {
  it("should describe the organization, website and app in one schema.org graph", () => {
    expect(homeStructuredData({ version: "0.3.4" })).toEqual({
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Organization",
          "@id": "https://accountant24.ai/#organization",
          name: "Accountant24",
          url: "https://accountant24.ai",
          sameAs: ["https://github.com/machulav/accountant24"],
        },
        {
          "@type": "WebSite",
          "@id": "https://accountant24.ai/#website",
          name: "Accountant24",
          url: "https://accountant24.ai",
          publisher: { "@id": "https://accountant24.ai/#organization" },
        },
        {
          "@type": "SoftwareApplication",
          "@id": "https://accountant24.ai/#software",
          name: "Accountant24",
          applicationCategory: "FinanceApplication",
          operatingSystem: "macOS",
          description:
            "Accountant24 is an open source AI agent for personal finance. Log spending in plain language, import bank statements, CSV exports and receipts, ask questions about your money. Your data stays on your machine as plain text files, versioned with git.",
          url: "https://accountant24.ai",
          downloadUrl: "https://github.com/machulav/accountant24/releases/latest/download/Accountant24.dmg",
          softwareHelp: "https://accountant24.ai/docs/quickstart",
          license: "https://www.apache.org/licenses/LICENSE-2.0",
          isAccessibleForFree: true,
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
          publisher: { "@id": "https://accountant24.ai/#organization" },
          softwareVersion: "0.3.4",
        },
      ],
    });
  });

  it("should omit softwareVersion when the version is unknown", () => {
    const graph = homeStructuredData({ version: null })["@graph"] as Record<string, unknown>[];
    const software = graph.find((node) => node["@type"] === "SoftwareApplication");
    expect(software).toBeDefined();
    expect(software).not.toHaveProperty("softwareVersion");
  });
});
