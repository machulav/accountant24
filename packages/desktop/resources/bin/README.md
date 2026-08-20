# Vendored native tools (bundled into the .app at build time).
# hledger, pdftotext (poppler), tesseract, and python/ (a python-build-standalone
# interpreter) are written here by scripts/vendor-bin.ts. They are resolved by
# absolute path via injected PATH (see electron/main/env.ts).
