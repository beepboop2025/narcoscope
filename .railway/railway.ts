import { defineRailway, project, service } from "railway/iac";

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
      // Railway normalizes its ON_FAILURE default to null in the IaC state
      // graph. Omitting the default keeps plans idempotent while the deployed
      // service manifest still resolves to ON_FAILURE.
      restartPolicyMaxRetries: 5,
    },
    domains: ["narcoscope.com", "www.narcoscope.com"],
  });

  return project("narcoscope", {
    resources: [web],
  });
});
