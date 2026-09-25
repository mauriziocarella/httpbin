# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.2] - 2026-09-25

### Added

- Display the current application version in the interface header.

## [0.1.1] - 2026-09-25

### Fixed

- Resolve source IP addresses from forwarding headers when requests arrive through a configured trusted reverse proxy.

## [0.1.0] - 2026-09-25

### Added

- Public webhook endpoints with real-time event inspection over Server-Sent Events.
- Configurable responses, matching rules, templates, presets, delays, and random status codes.
- SQLite persistence with JSON migration, retention policies, pagination, and per-endpoint limits.
- Request filtering, raw and formatted payload views, cURL copy, and JSON export.
- Sensitive header redaction, custom redaction rules, and optional IP anonymization.
- Responsive React interface with light, dark, and system themes.
- Docker image, Traefik deployment configuration, health checks, and release automation.

[Unreleased]: https://github.com/mauriziocarella/httpbin/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/mauriziocarella/httpbin/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/mauriziocarella/httpbin/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/mauriziocarella/httpbin/releases/tag/v0.1.0
