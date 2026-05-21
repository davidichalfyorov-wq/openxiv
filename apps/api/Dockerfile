# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate
WORKDIR /app

# ---- Install workspace deps (cache-friendly) ----
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/feed-generator/package.json apps/feed-generator/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/clients/package.json packages/clients/package.json
COPY packages/lexicons/package.json packages/lexicons/package.json
COPY e2e/package.json e2e/package.json
RUN pnpm install --frozen-lockfile=false

# ---- Build workspace ----
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages packages
COPY apps apps
RUN pnpm --filter @openxiv/shared build \
 && pnpm --filter @openxiv/lexicons build \
 && pnpm --filter @openxiv/db build \
 && pnpm --filter @openxiv/clients build \
 && pnpm --filter @openxiv/api build

# ---- Runtime ----
# Earlier we tried to slim by reinstalling --prod against partial copies, which
# broke pnpm's hoisted symlinks (drizzle-orm / dotenv missing in /app/node_modules).
# Instead: copy the full /app tree from build. ~700-900 MB image but every
# resolver lookup works first try.
#
# poppler-utils provides `pdftocairo`, which the
# figure-extractor service shells out to for cropping GROBID-detected
# figure bboxes into 300dpi PNGs. The worker subprocess uses it; the
# main API request path does not, but the same image carries both.
FROM node:22-bookworm-slim AS runtime
# Tectonic and LaTeXML both run in-process in the worker container.
# LaTeXML needs the TeXLive subsets below for common math/science papers.
# Enable contrib/non-free for Microsoft's core-font installer. The EULA is
# accepted non-interactively so fontspec submissions using Times New Roman,
# Arial, Courier New, etc. compile in production instead of failing on missing
# system fonts.
RUN sed -i 's/Components: main/Components: main contrib non-free non-free-firmware/g' /etc/apt/sources.list.d/debian.sources \
 && echo "ttf-mscorefonts-installer msttcorefonts/accepted-mscorefonts-eula select true" | debconf-set-selections \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      fontconfig \
      fonts-arphic-ukai \
      fonts-arphic-uming \
      fonts-cmu \
      fonts-crosextra-caladea \
      fonts-crosextra-carlito \
      fonts-dejavu \
      fonts-dejavu-extra \
      fonts-ebgaramond \
      fonts-ebgaramond-extra \
      fonts-firacode \
      fonts-freefont-otf \
      fonts-freefont-ttf \
      fonts-gfs-artemisia \
      fonts-gfs-baskerville \
      fonts-gfs-bodoni-classic \
      fonts-gfs-complutum \
      fonts-gfs-didot \
      fonts-gfs-didot-classic \
      fonts-gfs-gazis \
      fonts-gfs-neohellenic \
      fonts-gfs-olga \
      fonts-gfs-porson \
      fonts-gfs-solomos \
      fonts-gfs-theokritos \
      fonts-hack \
      fonts-inconsolata \
      fonts-ipafont \
      fonts-liberation \
      fonts-liberation2 \
      fonts-linuxlibertine \
      fonts-lmodern \
      fonts-noto-cjk \
      fonts-noto-color-emoji \
      fonts-noto-core \
      fonts-noto-extra \
      fonts-noto-mono \
      fonts-noto-ui-core \
      fonts-noto-ui-extra \
      fonts-sil-andika \
      fonts-sil-charis \
      fonts-sil-doulos \
      fonts-sil-gentium \
      fonts-sil-gentiumplus \
      fonts-stix \
      fonts-symbola \
      fonts-texgyre \
      fonts-texgyre-math \
      fonts-unfonts-core \
      latexml \
      libxml-libxslt-perl \
      perl \
      poppler-utils \
      tar \
      texlive-fonts-recommended \
      texlive-fonts-extra \
      texlive-fonts-extra-links \
      texlive-latex-base \
      texlive-latex-extra \
      texlive-science \
      tini \
      ttf-mscorefonts-installer \
      unzip \
 && curl -fsSL "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%400.15.0/tectonic-0.15.0-x86_64-unknown-linux-gnu.tar.gz" -o /tmp/tectonic.tar.gz \
 && tar -xzf /tmp/tectonic.tar.gz -C /usr/local/bin tectonic \
 && chmod +x /usr/local/bin/tectonic \
 && fc-cache -f \
 && rm -f /tmp/tectonic.tar.gz \
 && rm -rf /var/lib/apt/lists/* \
 && tectonic --version \
 && latexml --VERSION \
 && latexmlpost --VERSION
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app /app

COPY apps/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 4000
ENTRYPOINT ["tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["api"]
