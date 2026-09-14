ARG CODEX_VERSION=0.154.0
ARG GROK_VERSION=1.0.30

FROM node:24.21.0-bookworm-slim AS cli-runtime
ARG CODEX_VERSION
ARG GROK_VERSION
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && npm install --global "@openai/codex@${CODEX_VERSION}" \
  && export GROK_BIN_DIR=/usr/local/bin \
  && curl -fsSL https://x.ai/cli/install.sh | bash -s -- "${GROK_VERSION}" \
  && cp -L /usr/local/bin/grok /usr/local/bin/grok.bin \
  && mv /usr/local/bin/grok.bin /usr/local/bin/grok \
  && codex --version | grep -F "codex-cli ${CODEX_VERSION}" \
  && grok --version | grep -F "grok ${GROK_VERSION}"

FROM cli-runtime AS build
RUN corepack enable && corepack prepare pnpm@12.4.1 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @task-lane/domain build && pnpm --filter @task-lane/db build && pnpm --filter @task-lane/plane build && pnpm --filter @task-lane/worker build
FROM cli-runtime AS runtime
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@12.4.1 --activate
WORKDIR /app
COPY --from=build /app /app
CMD ["pnpm", "--filter", "@task-lane/worker", "start"]
