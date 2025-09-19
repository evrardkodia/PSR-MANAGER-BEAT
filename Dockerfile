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

# 🔒 Neutraliser tout fallback (avant même de copier le code)
# - Purge freepats (si installé)
# - Écrase la config système par une config "vide"
RUN apt-get purge -y freepats || true && \
    mkdir -p /etc/timidity && \
    printf 'dir /nonexistent\n' > /etc/timidity/timidity.cfg && \
    printf 'dir /nonexistent\n' > /etc/timidity/deny.cfg

# Par défaut, même si quelqu'un lance timidity sans -c, on pointe vers une cfg "deny"
ENV TIMIDITY_CFG=/etc/timidity/deny.cfg

# Nettoyage APT
RUN apt-get clean && rm -rf /var/lib/apt/lists/*

# Node.js 18 (NodeSource)
RUN curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/trusted.gpg.d/nodesource.gpg && \
    echo "deb https://deb.nodesource.com/node_18.x nodistro main" > /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# (Optionnel) FluidSynth — tu peux le garder si nécessaire
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

# Copier le reste du code (incluant le SF2 via LFS)
COPY . .

# ✅ Sanity check : s'assurer que le SF2 LFS est bien présent
# (échec du build sinon ; il faut avoir fait `git lfs pull` avant `docker build`)
RUN test -s /app/soundfonts/Yamaha_PSR.sf2 || (echo '❌ SF2 absent (LFS non résolu). Lance `git lfs pull` avant `docker build`.' && exit 1)

# Port
EXPOSE 10000

# Démarrage
CMD ["node", "server.js"]
