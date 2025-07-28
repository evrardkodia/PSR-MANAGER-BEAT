FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Installer les dépendances système + Node.js 18
RUN apt-get update && \
    apt-get install -y curl gnupg && \
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y \
    nodejs \
    npm \
    python3 \
    python3-pip \
    timidity \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Définir le dossier de travail
WORKDIR /app

# Copier les fichiers nécessaires
COPY package*.json ./
COPY requirements.txt ./
COPY prisma ./prisma

# Installer dépendances Node.js et générer Prisma
RUN npm install
RUN npx prisma generate

# Installer dépendances Python
RUN pip3 install --no-cache-dir -r requirements.txt

# Copier tout le reste du projet
COPY . .

# Exposer le port
EXPOSE 10000

# Démarrer l'application
CMD ["node", "server.js"]
