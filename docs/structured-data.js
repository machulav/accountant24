// Injects schema.org JSON-LD structured data on every page.
// Mintlify loads any .js file in the content directory globally, so this
// script branches on the current path and appends one <script type="application/ld+json">.
(function () {
  var BASE = "https://accountant24.ai";

  var organization = {
    "@type": "Organization",
    "@id": BASE + "/#organization",
    name: "Accountant24",
    url: BASE,
    sameAs: ["https://github.com/machulav/accountant24"],
  };

  var website = {
    "@type": "WebSite",
    "@id": BASE + "/#website",
    name: "Accountant24",
    url: BASE,
    publisher: { "@id": BASE + "/#organization" },
  };

  var software = {
    "@type": "SoftwareApplication",
    "@id": BASE + "/#software",
    name: "Accountant24",
    applicationCategory: "FinanceApplication",
    operatingSystem: "macOS, Linux",
    description:
      "Local-first AI agent for personal finance. Track spending in plain language; your data stays as plain-text files on your machine.",
    url: BASE,
    downloadUrl: "https://github.com/machulav/accountant24",
    softwareHelp: BASE + "/quickstart",
    license: "https://opensource.org/licenses/MIT",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    publisher: { "@id": BASE + "/#organization" },
  };

  function qa(question, answer) {
    return {
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    };
  }

  var faqPage = {
    "@type": "FAQPage",
    "@id": BASE + "/faq#faqpage",
    mainEntity: [
      qa(
        "Is my financial data private?",
        "Yes. Everything stays on your machine as plain-text files. Nothing is uploaded unless you choose to push your git repo to a remote you control. Run a local model with Ollama and even the AI runs on your device, so nothing leaves your computer."
      ),
      qa(
        "Does it work offline?",
        "Yes, with a local model via Ollama. Cloud providers (OpenAI, Anthropic) need a connection, but you can switch to a local model anytime and keep working fully offline."
      ),
      qa(
        "Which LLMs can I use?",
        "Any of them: OpenAI, Anthropic, or local models through Ollama. Switch providers whenever you like without changing your data."
      ),
      qa(
        "Is it really free?",
        "Yes. Accountant24 is free and open source (MIT), with no subscription. If you use a paid LLM provider you pay them for your own usage; with a local model there's nothing to pay at all."
      ),
      qa(
        "What format is my data in, and is there lock-in?",
        "Your data is plain-text hledger journal files that you fully own, tracked with git. There's no proprietary database and no lock-in. If Accountant24 ever went away, your books would still open in hledger."
      ),
    ],
  };

  var graph = [organization, website];

  var path = window.location.pathname.replace(/\/+$/, "");
  if (path === "" || path === "/index") {
    graph.push(software);
  } else if (path === "/faq") {
    graph.push(faqPage);
  }

  var el = document.createElement("script");
  el.type = "application/ld+json";
  el.text = JSON.stringify({ "@context": "https://schema.org", "@graph": graph });
  document.head.appendChild(el);
})();
