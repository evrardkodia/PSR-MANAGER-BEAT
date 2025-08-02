FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Installer les dépendances système nécessaires
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
    ca-certificates

# ✅ Installation de Timidity (sans suppression préalable)
RUN apt update && \
    apt install -y timidity timidity-interfaces-extra && \
    timidity --version

# Nettoyage
RUN apt-get clean && rm -rf /var/lib/apt/lists/*

# Installer Node.js 18 depuis NodeSource
RUN curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/trusted.gpg.d/nodesource.gpg && \
    echo "deb https://deb.nodesource.com/node_18.x nodistro main" > /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Cloner et compiler FluidSynth (dernière version stable)
RUN git clone --depth 1 https://github.com/FluidSynth/fluidsynth.git /tmp/fluidsynth && \
    mkdir /tmp/fluidsynth/build && \
    cd /tmp/fluidsynth/build && \
    cmake .. -Denable-ladspa=OFF -Denable-aufile=OFF -Denable-dbus=OFF && \
    make -j$(nproc) && \
    make install && \
    ldconfig

# Dossier de travail
WORKDIR /app

# Copier les fichiers de configuration
COPY package*.json ./ 
COPY requirements.txt ./ 
COPY prisma ./prisma

# Installer les dépendances Node.js et Prisma
RUN npm install
RUN npx prisma generate

# Installer les dépendances Python
RUN pip3 install --no-cache-dir -r requirements.txt

# Télécharger le SoundFont
RUN mkdir -p /app/soundfonts && \
    curl -L -o /app/soundfonts/Yamaha_PSR.sf2 https://pub-70e217e0437d4b508fcd492d95212e77.r2.dev/Yamaha_PSR.sf2

# Copier le reste du code
COPY . .

# Exposer le port
EXPOSE 10000

# Commande de démarrage
CMD ["node", "server.js"]
