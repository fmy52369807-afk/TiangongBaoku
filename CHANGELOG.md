# Changelog

All notable changes to TiangongBaoku are documented here.

## [0.2.0] - 2026-08-10

### Added

- Public-release audit covering credentials, runtime data, Legado compatibility and content boundaries.
- Reproducible unit tests for rule parsing, URL/template handling, network policy, HLS rewriting, concurrency and health APIs.
- Source inventory and optional connectivity metrics collector with explicit configured/enabled/verified counts.
- Anonymous five-category Demo fixtures and a reproducible portfolio screenshot script.
- Cold-start benchmark and a timestamped, redacted external-source verification report.
- GitHub Actions CI for Node.js 18, 20 and 22.
- `.env.example`, ISC license text and release documentation.

### Changed

- README now describes the real modular-monolith architecture and the independent Legado-compatible execution layer.
- Package metadata and lockfiles are synchronized at version 0.2.0.
- Tauri version detection now validates the TiangongBaoku product/version response instead of legacy branding.
- Removed local databases, stale build bundles and legacy source collections containing third-party authorization material from the publish tree.

### Known limitations

- External source availability, legality and content change independently of this repository.
- Java/Android compatibility is intentionally partial and JavaScript rules run in a constrained sandbox.
- Tauri packaging requires a Windows WebView2/Rust toolchain and is not built in CI.
- Portfolio screenshots were not regenerated because the local Playwright browser process timed out; the fixture and capture script remain reproducible.
