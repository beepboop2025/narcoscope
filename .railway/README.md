# Railway infrastructure contract

This project uses Railway Infrastructure as Code rather than the deprecated
per-deployment `railway.json` contract.

Review and apply infrastructure before a release:

```sh
npm ci
railway config plan
railway config apply
```

The service intentionally has no GitHub or image source. The Hetzner fleet
publisher checks out exact public `main`, injects its content-addressed
`release-manifest.json`, and uploads that immutable bundle with `railway up`.
The runtime derives its commit, release ID and tree digest from that file, and
`/healthz` fails closed when the manifest is invalid. The optional
`NARCOSCOPE_REVISION` local-development fallback is consulted only when no fleet
manifest exists, so stale Railway configuration cannot override bundle
identity. Railway's documented default restart policy is `On Failure`; the IaC
definition omits that default because Railway normalizes it to `null` in the
state graph, while retaining the explicit five-retry ceiling.
