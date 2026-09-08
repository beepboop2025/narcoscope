# Railway portable CI

This credential-free build runs the existing tests workflow on Node20:
`npm ci`, `npm test -- --coverage`, and `npm run build`, including the checked-in
bridge/news/wire contracts and TypeScript/Vite production build. Failures stop
the image build and fail Railway's native commit check. The finite runtime
verifies the successful build receipt against its exact source commit.

The tested PR head must already include current main; stale branches fail
admission rather than claim integration coverage. The Dockerfile-specific ignore
file retains `.github` because existing tests inspect the release and collector
workflows. Production Docker/IaC configuration is unaffected.

Use the existing isolated public PR base with no service/project credentials,
volumes or public endpoints, one replica, and restart policy NEVER. GitHub's
external-contributor fallback remains until Railway can admit those PRs. Registry
publication and refresh workflows retain their separate identities and gates.
