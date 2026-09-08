FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git python3 tini \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG RAILWAY_GIT_COMMIT_SHA
ARG RAILWAY_DEPLOYMENT_ID
RUN printf '%s\n' "$RAILWAY_GIT_COMMIT_SHA" | grep -Eq '^[0-9a-f]{40}$' \
    && git -c core.hooksPath=/dev/null init /ci-source \
    && git -C /ci-source remote add origin https://github.com/beepboop2025/narcoscope.git \
    && git -C /ci-source -c core.hooksPath=/dev/null fetch --filter=blob:none --depth=256 origin main "$RAILWAY_GIT_COMMIT_SHA" \
    && git -C /ci-source merge-base --is-ancestor refs/remotes/origin/main "$RAILWAY_GIT_COMMIT_SHA" \
    && printf 'RAILWAY_CI_SOURCE_ADMITTED head=%s base=%s\n' \
         "$RAILWAY_GIT_COMMIT_SHA" "$(git -C /ci-source rev-parse refs/remotes/origin/main)"
RUN timeout --signal=TERM --kill-after=30 1200 sh deploy/railway-ci/run.sh
ENTRYPOINT ["/usr/bin/tini", "-s", "--"]
CMD ["node", "deploy/railway-ci/verify-build.mjs"]
