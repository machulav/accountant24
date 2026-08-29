# Vendored native tools (bundled into the .app at build time).
# hledger, pdftotext (poppler), tesseract and uv are written here by
# scripts/vendor-bin.ts. They reach the agent's subprocesses through the
# injected PATH (see src/main/env.ts agentEnv()).
