FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Dépendances système (FFmpeg inclus)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
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
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# ✅ TiMidity
RUN apt-get update && apt-get install -y --no-install-recommends \
    timidity timidity-interfaces-extra \
    && rm -rf /var/lib/apt/lists/*

# 🔒 Neutraliser les fallbacks globaux TiMidity (si quelqu’un lance sans -c)
RUN apt-get purge -y freepats || true && \
    mkdir -p /etc/timidity && \
    printf 'dir /nonexistent\n' > /etc/timidity/timidity.cfg && \
    printf 'dir /nonexistent\n' > /etc/timidity/deny.cfg
ENV TIMIDITY_CFG=/etc/timidity/deny.cfg

# Node.js 18 (NodeSource)
RUN curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | \
    gpg --dearmor -o /etc/apt/trusted.gpg.d/nodesource.gpg && \
    echo "deb https://deb.nodesource.com/node_18.x nodistro main" > /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

# (Optionnel) FluidSynth — garde si tu en as besoin
RUN git clone --recurse-submodules --depth 1 https://github.com/FluidSynth/fluidsynth.git /tmp/fluidsynth && \
    mkdir /tmp/fluidsynth/build && cd /tmp/fluidsynth/build && \
    cmake .. -Denable-ladspa=OFF -Denable-aufile=OFF -Denable-dbus=OFF && \
    make -j"$(nproc)" && make install && ldconfig && \
    rm -rf /tmp/fluidsynth

# Dossier de travail
WORKDIR /app

# Fichiers de config/projet
COPY package*.json ./
COPY requirements.txt ./
COPY prisma ./prisma

# Dépendances Node & Prisma
RUN npm install && npx prisma generate

# Dépendances Python
RUN pip3 install --no-cache-dir -r requirements.txt

# Copier le reste du code (⚠️ sans gros SF2 dans l’image)
COPY . .

# Variables par défaut (peuvent être surchargées dans Render → Environment)
ENV SF2_PATH=/app/soundfonts/Yamaha_PSR.sf2
# Laisse SF2_URL vide par défaut : tu la définis dans Render (ou mets une valeur par défaut dans bin/boot.sh)

# S’assurer que le script de démarrage est exécutable
RUN test -f /app/bin/boot.sh || (echo '❌ /app/bin/boot.sh manquant' && exit 1) && \
    chmod +x /app/bin/boot.sh

# Port HTTP
EXPOSE 10000

# Démarrage : passe par ton boot.sh (télécharge SF2 si absent, verrouille TiMidity, lance Node)
CMD ["/app/bin/boot.sh"]
