# Enclave image for the DvP sequencer. Build from the repo root:
#   docker build -f services/tee-sequencer/Dockerfile -t cordon-sequencer .
FROM oven/bun:1.3.13@sha256:87416c977a612a204eb54ab9f3927023c2a3c971f4f345a01da08ea6262ae30e AS app
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY packages/shared packages/shared
COPY packages/sdk packages/sdk
COPY services/tee-sequencer services/tee-sequencer
COPY public/circuits circuits
RUN bun install --frozen-lockfile --ignore-scripts --production --filter @cordon/tee-sequencer
ENV CIRCUITS_DIR=/app/circuits PORT=8080
EXPOSE 8080
CMD ["bun", "services/tee-sequencer/src/server.ts"]
