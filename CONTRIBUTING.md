# Contributing

Report reproducible issues with XMi version, host/version, operating system, redacted steps and exact error code. Do not attach private designs, full chats, credentials or databases.

Use Node 24.20.0 / npm 11.19.0. Run npm ci --ignore-scripts, npm run lint, npm run build, npm test and npm run check. Self-check uses synthetic temporary data; it is not a host UI test. Public archives omit private installation state and historical private evidence.

Keep changes focused. Preserve schemas, provenance, explicit Owner confirmation, atomicity and honest readiness. Add targeted tests for changed behavior. Schema migrations, authentication/hosting and XMi/XDev/XMem boundaries require prior design discussion. Do not weaken blockers to make a project ready.

The local DOCX API derivative retains third-party source/license bytes. Run npm run check:docx-source and node tools/build-docx-browser.mjs --check when changing dependencies. Refresh browser components/licenses using the fixed build tool and root lockfile. Review upstream advisories under the original Mammoth identity; do not reformat vendored source or update hashes merely to bypass verification. See docs/public/DOCX-DEPENDENCY.md.

PRs should explain the problem, resulting behavior, tests actually run and remaining limits. CI is configured for Windows and Linux; configuration alone does not establish a passing run.
