# NevDraw: one always-on process serving the web app, the room WebSocket and the parser.
# Rooms live in memory, so run exactly one instance; boards persist in SQLite on /data.
FROM oven/bun:1.4.2 AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/parser/package.json packages/parser/
RUN bun install --frozen-lockfile
COPY . .
# The web app, and the parser model pinned in models/parser.json (downloaded and checksummed).
RUN bun run build && bun run fetch-model

FROM oven/bun:1.4.2
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production \
    PORT=8080 \
    DB_PATH=/data/boards.sqlite \
    PARSER_LOG=/data/parser-shadow.jsonl
EXPOSE 8080
# Keys (TYPESAFE_API_KEY, GPTOSS_API_KEY, ...) come from the host's secrets, not a .env file.
CMD ["bun", "apps/server/src/main.ts"]
