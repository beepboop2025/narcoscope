FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates git openssh-client procps python3 tini unzip \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /controller
COPY Dockerfile refresh.py isolation.py test_refresh.py github-known-hosts manifest.json ./
RUN python3 -c 'import refresh; refresh.verify_controller()' \
    && /usr/bin/tini -s -- python3 test_refresh.py
ENTRYPOINT ["/usr/bin/tini", "-s", "--"]
CMD ["timeout", "--signal=TERM", "--kill-after=30", "2100", "python3", "-u", "refresh.py"]
