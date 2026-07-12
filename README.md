# mingasolutions.com

Personal portfolio and free IT tools site for [Andrew Minga](https://mingasolutions.com). Static HTML, one CSS file, vanilla JavaScript. No framework, no build system, no CMS. Built with Claude Code, deployed on Cloudflare Pages.

## What's here

| Area | Description |
|------|-------------|
| **Portfolio** | Experience, skills, Microsoft cert verification links, project case studies |
| **[Tools](https://mingasolutions.com/tools/)** | 12 free browser-based IT tools (see below) |
| **[Blog](https://mingasolutions.com/blog/)** | Writing on Azure, MSP automation, and AI tooling; select LinkedIn posts mirror here automatically |
| **Interests** | The person behind the certs |

## The tools

All client-side: DNS queries go through Cloudflare DNS-over-HTTPS, registry data through RDAP, and file parsing never leaves the browser. Nothing is stored or logged by this site.

- **Email Security Checker** — SPF, DMARC, DKIM (33-selector discovery), MX, BIMI, MTA-STS, TLS-RPT
- **DMARC Report Analyzer** — parses rua aggregate XML/gz/zip locally; sources, pass rates, reject impact
- **DNS Lookup** — 12 record types including DNSSEC
- **Reverse DNS** — IPv4/IPv6 PTR with forward-confirmation (FCrDNS)
- **WHOIS / RDAP** — domain and IP registration data
- **Email Header Analyzer** — delivery path, delays, auth results, spoofing red flags
- **SPF + DMARC Generators** — with the 10-lookup limit counted
- **Subnet Calculator**, **Internet Speed Test** (Cloudflare's open-source engine), **IP Location**, **What's My IP** (dual-stack)

## Architecture notes

- `js/tools.js` — shared tool logic, one file, feature-detected per page
- `js/email-checker.js`, `js/dmarc-analyzer.js` — the two larger tools
- `assets/vendor/` — self-hosted third-party code (@cloudflare/speedtest, MIT)
- Blog posts mirrored from LinkedIn are inserted by [an external pipeline](https://github.com/amingacspire) via the GitHub Contents API, keyed on HTML markers in `blog/index.html`, `sitemap.xml`, and `feed.xml`
- `.github/workflows/linkedin-crosspost.yml` — opt-in blog-to-LinkedIn sharing, gated on a `[crosspost]` commit tag

## License

Code: MIT. Content (writing, case studies, images): all rights reserved.
