# Static assets are platform independent; build once without emulating target CPUs.
FROM --platform=$BUILDPLATFORM node:26.13.0-alpine3.23 AS build

WORKDIR /app
RUN npm install --global pnpm@12.21.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM nginx:1.30.6-alpine AS runtime

LABEL org.opencontainers.image.licenses="MIT"
COPY LICENSE /usr/share/licenses/scoretrackrr/LICENSE
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/build/ /usr/share/nginx/html/
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD ["wget", "-q", "--spider", "http://127.0.0.1:8080/"]
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
