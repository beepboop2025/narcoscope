# Railway infrastructure contract

This project uses Railway Infrastructure as Code rather than the deprecated
per-deployment `railway.json` contract.

Review and apply infrastructure before a release:

```sh
npm ci
railway config plan
railway config apply
```

The service intentionally has no GitHub or image source. Set
`NARCOSCOPE_REVISION` to the exact release commit and deploy the local worktree
with `railway up`; the health endpoint fails closed if that revision is absent
or malformed.
