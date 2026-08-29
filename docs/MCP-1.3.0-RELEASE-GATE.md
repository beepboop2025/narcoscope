# NarcoScope MCP 1.3.0 release gate

This is a pre-release observation receipt, not a deployment or Registry publication claim.

Observed at `2026-08-29T14:58:55Z`:

- `https://narcoscope.com` was configured and served the Vercel deployment. Its `server.json` and MCP `initialize` response reported `1.2.0`.
- `https://www.narcoscope.com` resolved to the Railway deployment at source revision `e086dbb47ccd67423954aaf62af50e584c68566d`; its MCP response also reported `1.2.0`.
- the official MCP Registry returned `io.github.beepboop2025/narcoscope` version `1.1.0` with `status=active` and `isLatest=true`.
- neither live endpoint implemented the MCP `2026-07-28` `server/discover` lifecycle yet. The staged `1.3.0` source does.

The `Publish to MCP Registry` workflow therefore fails closed unless all of these conditions hold in order:

1. The manually supplied 40-character commit equals the workflow SHA and exact `origin/main`.
2. `server.json` equals the web-served manifest and passes the checksum-pinned official publisher validator.
3. `https://narcoscope.com/server.json` byte-matches the release card.
4. `https://narcoscope.com/mcp` completes a header-validated, sessionless `2026-07-28` `server/discover` request and reports server version `1.3.0`.
5. Only then may OIDC publication run.
6. After publication, both the exact `1.3.0` Registry record and `versions/latest` must report `active`, and the latter must report `isLatest=true`.

Do not describe 1.3.0 as live or Registry-published until those gates produce receipts.
