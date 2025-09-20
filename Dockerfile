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

# 🔒 Neutraliser tout fallback global (au cas où quelqu’un lance timidity sans -c)
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

# (Optionnel) FluidSynth — laisse si tu en as besoin ailleurs
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

# Copier le reste du code (le SF2 peut ne PAS être présent dans le contexte — OK)
COPY . .

# Default configurable: où sera cherché le SF2 au runtime
ENV SF2_PATH=/app/soundfonts/Yamaha_PSR.sf2

# 🧠 Entry point: récupère le SF2 si absent, force une cfg TiMidity minimale, puis lance Node
RUN printf '%s\n' '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  ': "${SF2_PATH:=/app/soundfonts/Yamaha_PSR.sf2}"' \
  'if [[ ! -s "$SF2_PATH" ]]; then' \
  '  if [[ -n "${SF2_URL:-}" ]]; then' \
  '    echo "⬇️  Téléchargement SF2: $SF2_URL -> $SF2_PATH"' \
  '    mkdir -p "$(dirname "$SF2_PATH")"' \
  '    curl -L --fail --retry 3 -o "$SF2_PATH" "$SF2_URL"' \
  '  else' \
  '    echo "⚠️  SF2 introuvable & SF2_URL non défini. Le rendu risque d’échouer."' \
  '  fi' \
  'fi' \
  'echo -e "dir /nonexistent\nsoundfont \"$SF2_PATH\"" > /etc/timidity/run.cfg' \
  'export TIMIDITY_CFG=/etc/timidity/run.cfg' \
  'exec node server.js' > /usr/local/bin/entry.sh \
  && chmod +x /usr/local/bin/entry.sh

# Port
EXPOSE 10000

# Démarrage: passe par l’entrypoint pour verrouiller le SF2 à chaque run
CMD ["/usr/local/bin/entry.sh"]
