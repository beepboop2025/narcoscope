import { defineRailway, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  const web = service("narcoscope-web", {
    // No source is declared: exact local worktree bytes remain the deployment
    // source instead of GitHub or a mutable container tag.
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "Dockerfile.railway",
    },
    deploy: {
      healthcheckPath: "/healthz",
      healthcheckTimeout: 180,
      numReplicas: 1,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 5,
    },
    domains: ["narcoscope.com", "www.narcoscope.com"],
    env: {
      // Each local release updates this exact-revision gate before upload.
      NARCOSCOPE_REVISION: preserve(),
    },
  });

  return project("narcoscope", {
    resources: [web],
  });
});
