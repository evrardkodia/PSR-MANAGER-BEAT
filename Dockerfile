FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Installer les dépendances système
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    python3 \
    python3-pip \
    timidity \
    ca-certificates \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Installer Node.js 18 directement depuis NodeSource sans script interactif
RUN curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/trusted.gpg.d/nodesource.gpg && \
    echo "deb https://deb.nodesource.com/node_18.x nodistro main" > /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && \
    apt-get install -y nodejs

# Définir le dossier de travail
WORKDIR /app

# Copier les fichiers nécessaires
COPY package*.json ./
COPY requirements.txt ./
COPY prisma ./prisma

# Installer les dépendances Node.js et Prisma
RUN npm install
RUN npx prisma generate

# Installer les dépendances Python
RUN pip3 install --no-cache-dir -r requirements.txt

# --- AJOUT pour SoundFont ---
RUN mkdir -p /app/soundfonts && \
    curl -L -o /app/soundfonts/Yamaha_PSR.sf2 https://pub-70e217e0437d4b508fcd492d95212e77.r2.dev/Yamaha_PSR.sf2

# Copier le reste du projet
COPY . .

# Exposer le port
EXPOSE 10000

# Commande de démarrage
CMD ["node", "server.js"]
