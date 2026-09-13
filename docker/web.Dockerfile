FROM node:24.21.0-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@12.4.1 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile=false
RUN pnpm --filter @task-lane/domain build && pnpm --filter @task-lane/db build && pnpm --filter @task-lane/plane build && pnpm --filter @task-lane/web build
FROM node:24.21.0-bookworm-slim AS runtime
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@12.4.1 --activate
WORKDIR /app
COPY --from=build /app /app
EXPOSE 3000
CMD ["pnpm", "--filter", "@task-lane/web", "start"]
