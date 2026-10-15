# DOCX dependency provenance

XMi uses a private local API-only derivative, @xmi/mammoth-api 1.12.3-xmi.1, under packages/mammoth-api. The parser sources are retained from official Mammoth 1.12.3 without algorithm changes. The unused CLI, its main entry and argparse dependency are removed, so the sprintf-js advisory chain is absent from the installed root graph. This is a maintained derivative, not an assertion that upstream released a security patch.

UPSTREAM.json records the official tarball URL/SHA-512 and SHA-256 of every retained file. LICENSE preserves Mammoth's BSD-2-Clause notice. UPSTREAM-PACKAGE.json is historical metadata, not the package installed by npm. Browser component versions, source hashes, output hash and license texts are recorded in browser.SBOM.json and THIRD-PARTY-NOTICES.txt. The browser artifact is rebuilt against the current root lockfile instead of copying the older upstream bundled dependencies.

Normal installation needs no global Mammoth, Python, office application or additional install script. npm ci installs the checked-in local dependency. Existing file-size/time/output/process limits remain. Original imported files remain user-managed.

For a reviewed upstream refresh, obtain only the recorded official archive and verify its SHA-512, review the source/metadata changes, regenerate the managed source manifest, and run:

```sh
npm ci --ignore-scripts
npm run check:docx-source
npm run build:docx-browser
node tools/build-docx-browser.mjs --check
npm audit
npm test
```

tools/prepare-docx-api.mjs --archive accepts only the pinned archive and refuses replacing an existing source directory. Review an upstream update explicitly; never overwrite hashes just to make verification pass. Do not use npm audit fix --force to downgrade Mammoth or hide the advisory. Check future upstream Mammoth and bundled-component advisories using the recorded original identities, since a local package name is not sufficient vulnerability tracking.

The existing raw-text API flattens soft line breaks and does not preserve Word visual layout. Paragraph breaks, tabs and table-cell text are regression-tested. A zero npm report describes the scanned dependency graph, not a guarantee that all parser or application vulnerabilities are absent.
