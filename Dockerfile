# Một image cho app (công khai), admin (Tailscale) và worker (SPEC §14b, phase 19).
# - app/admin: Next standalone (`node .next/standalone/server.js`), khác nhau ở ADMIN_ENABLED.
# - worker: `worker/index.ts` bundle bằng esbuild (standalone không đóng gói worker/).
# - migrate / seed / create-first-admin dùng chung image (cần prisma CLI và tsx nên giữ node_modules).

FROM node:20-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN pnpm install --frozen-lockfile
COPY . .
# Site key Turnstile là giá trị công khai, cần lúc build cho client bundle.
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY
RUN pnpm prisma generate \
  && pnpm build \
  && pnpm exec esbuild worker/index.ts --bundle --platform=node --target=node20 --format=esm \
       --conditions=react-server --packages=external --outfile=dist/worker/index.mjs \
  && cp -r public .next/standalone/public \
  && mkdir -p .next/standalone/.next && cp -r .next/static .next/standalone/.next/static

FROM node:20-bookworm-slim AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PNPM_HOME=/pnpm PATH=/pnpm:$PATH HOSTNAME=0.0.0.0 PORT=3000
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/* && groupadd --system cu && useradd --system --gid cu --uid 10002 --home /app cu
WORKDIR /app
COPY --from=build --chown=cu:cu /app /app
RUN mkdir -p /data/storage && chown cu:cu /data/storage /app
USER cu
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.status===204?0:1)).catch(()=>process.exit(1))"
CMD ["node", ".next/standalone/server.js"]
