FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Dépendances système (FFmpeg inclus)
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    git \
    python3 \
    python3-pip \
    build-essential \
    cmake \
    pkg-config \
    libglib2.0-dev \
    libsndfile1-dev \
    libasound2-dev \
    libjack-jackd2-dev \
    libpulse-dev \
    libreadline-dev \
    libfftw3-dev \
    ca-certificates \
    ffmpeg

# ✅ Installation TiMidity
RUN apt-get update && \
    apt-get install -y timidity timidity-interfaces-extra && \
    timidity --version

# 🔒 Neutraliser tout fallback global (si quelqu’un lance timidity sans -c)
RUN apt-get purge -y freepats || true && \
    mkdir -p /etc/timidity && \
    printf 'dir /nonexistent\n' > /etc/timidity/timidity.cfg && \
    printf 'dir /nonexistent\n' > /etc/timidity/deny.cfg
ENV TIMIDITY_CFG=/etc/timidity/deny.cfg

# Nettoyage APT
RUN apt-get clean && rm -rf /var/lib/apt/lists/*

# Node.js 18 (NodeSource)
RUN curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/trusted.gpg.d/nodesource.gpg && \
    echo "deb https://deb.nodesource.com/node_18.x nodistro main" > /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# (Optionnel) FluidSynth — garde si tu en as besoin ailleurs
RUN git clone --recurse-submodules --depth 1 https://github.com/FluidSynth/fluidsynth.git /tmp/fluidsynth && \
    mkdir /tmp/fluidsynth/build && \
    cd /tmp/fluidsynth/build && \
    cmake .. -Denable-ladspa=OFF -Denable-aufile=OFF -Denable-dbus=OFF && \
    make -j$(nproc) && \
    make install && \
    ldconfig

# Dossier de travail
WORKDIR /app

# Fichiers de config/projet
COPY package*.json ./
COPY requirements.txt ./
COPY prisma ./prisma

# Dépendances Node & Prisma
RUN npm install
RUN npx prisma generate

# Dépendances Python
RUN pip3 install --no-cache-dir -r requirements.txt

# Copier le reste du code (on N’EMBARQUE PAS le gros SF2)
COPY . .

# 🌟 Par défaut, on cherche le SF2 sur un DISQUE PERSISTANT (/data)
# (Configure un Disk Render monté sur /data)
ENV SF2_PATH=/data/Yamaha_PSR.sf2

# 🚀 ENTRYPOINT : télécharge le SF2 s’il manque, verrouille la cfg TiMidity, puis lance la commande
RUN printf '%s\n' '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  '' \
  '# --- paramètres ---' \
  ': "${SF2_PATH:=/data/Yamaha_PSR.sf2}"' \
  'SF2_DIR="$(dirname "$SF2_PATH")"' \
  '' \
  '# --- préparer le dossier cible (/data) ---' \
  'mkdir -p "$SF2_DIR"' \
  '' \
  '# --- télécharger le SF2 si absent ---' \
  'if [[ ! -s "$SF2_PATH" ]]; then' \
  '  if [[ -n "${SF2_URL:-}" ]]; then' \
  '    echo "⬇️  Téléchargement SF2: $SF2_URL -> $SF2_PATH"' \
  '    if [[ -n "${GITHUB_TOKEN:-}" ]]; then' \
  '      curl -H "Authorization: token ${GITHUB_TOKEN}" -L --fail --retry 3 -o "$SF2_PATH" "$SF2_URL"' \
  '    else' \
  '      curl -L --fail --retry 3 -o "$SF2_PATH" "$SF2_URL"' \
  '    fi' \
  '  else' \
  '    echo "⚠️  SF2 introuvable & SF2_URL non défini. Le rendu risque d’échouer."' \
  '  fi' \
  'fi' \
  '' \
  '# --- vérif d’intégrité optionnelle ---' \
  'if [[ -n "${SF2_SHA256:-}" && -s "$SF2_PATH" ]]; then' \
  '  echo "🔐 Vérification SHA256..."' \
  '  calc="$(sha256sum "$SF2_PATH" | awk "{print \$1}")"' \
  '  if [[ "$calc" != "$SF2_SHA256" ]]; then' \
  '    echo "❌ SHA256 mismatch: attendu=$SF2_SHA256 obtenu=$calc"' \
  '    exit 42' \
  '  fi' \
  'fi' \
  '' \
  '# --- cfg TiMidity MINIMALE : pas d include, 1 seul SF2 ---' \
  'echo -e "dir /nonexistent\nsoundfont \"$SF2_PATH\"" > /etc/timidity/run.cfg' \
  'export TIMIDITY_CFG=/etc/timidity/run.cfg' \
  '' \
  '# (facultatif) trace courte pour vérifier que timidity voit le SF2' \
  'timidity -c /etc/timidity/run.cfg -v | tail -n 20 || true' \
  '' \
  '# --- lancer la commande passée par CMD ---' \
  'exec "$@"' > /usr/local/bin/entry.sh && \
  chmod +x /usr/local/bin/entry.sh

# Port
EXPOSE 10000

# Démarrage via l’entrypoint (il prépare le SF2), puis exécute la commande
ENTRYPOINT ["/usr/local/bin/entry.sh"]
CMD ["node", "server.js"]
