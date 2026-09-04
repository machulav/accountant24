// schema.org JSON-LD for the home page. The docs site emits its own
// Organization/WebSite and the FAQPage (docs/structured-data.js); the
// SoftwareApplication lives here because the home page is where it is rendered.
import { site } from "../content/site";

export interface HomeStructuredDataInput {
  /** Latest release version, e.g. "0.3.4"; omitted when unknown. */
  version?: string | null;
}

export function homeStructuredData({ version }: HomeStructuredDataInput): Record<string, unknown> {
  const organization = {
    "@type": "Organization",
    "@id": `${site.url}/#organization`,
    name: site.name,
    url: site.url,
    logo: `${site.url}/apple-touch-icon.png`,
    sameAs: [site.github],
  };
  const website = {
    "@type": "WebSite",
    "@id": `${site.url}/#website`,
    name: site.name,
    url: site.url,
    publisher: { "@id": `${site.url}/#organization` },
  };
  const software = {
    "@type": "SoftwareApplication",
    "@id": `${site.url}/#software`,
    name: site.name,
    applicationCategory: "FinanceApplication",
    operatingSystem: "macOS",
    description: site.description,
    url: site.url,
    downloadUrl: site.downloadUrl,
    softwareHelp: `${site.url}${site.quickstartUrl}`,
    screenshot: `${site.url}/og.png`,
    license: "https://www.apache.org/licenses/LICENSE-2.0",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    publisher: { "@id": `${site.url}/#organization` },
    ...(version ? { softwareVersion: version } : {}),
  };
  return { "@context": "https://schema.org", "@graph": [organization, website, software] };
}
