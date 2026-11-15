# syntax=docker/dockerfile:1
#
# Build (from this directory; needs a token with read:packages for @sing3demons/* on GitHub Packages):
#   GITHUB_TOKEN=ghp_xxx docker build --secret id=github_token,env=GITHUB_TOKEN -t kp-bun-app .
# Run:
#   docker run --rm --init -p 3000:3000 kp-bun-app

# -- dependencies (from bun.lock) -------------------------------------------------
FROM oven/bun:1.3-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
# The token comes in as a build secret: it is never written to an image layer.
RUN --mount=type=secret,id=github_token,env=GITHUB_TOKEN \
    printf '@sing3demons:registry=https://npm.pkg.github.com/\n//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}\n' > .npmrc \
 && bun install --frozen-lockfile --production \
 && rm -f .npmrc

# -- runtime ---------------------------------------------------------------------
FROM oven/bun:1.3-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000
COPY --from=deps /app/node_modules ./node_modules
COPY package.json logger.yaml ./
COPY src ./src
USER bun
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1
CMD ["bun", "src/main.ts"]
