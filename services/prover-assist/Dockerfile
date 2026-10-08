# docker build -f services/prover-assist/Dockerfile -t cordon-prover .
FROM oven/bun:1.3.13@sha256:87416c977a612a204eb54ab9f3927023c2a3c971f4f345a01da08ea6262ae30e
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY packages/shared packages/shared
COPY packages/sdk packages/sdk
COPY services/prover-assist services/prover-assist
COPY public/circuits circuits
RUN bun install --frozen-lockfile --ignore-scripts --production --filter @cordon/prover-assist
ENV CIRCUITS_DIR=/app/circuits PORT=8081
EXPOSE 8081
CMD ["bun", "services/prover-assist/src/server.ts"]
