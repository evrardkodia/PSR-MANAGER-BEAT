FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Installer les dépendances système
RUN apt-get update && apt-get install -y \
    curl \
    timidity \
    python3 \
    python3-pip \
    nodejs \
    npm \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Définir le dossier de travail
WORKDIR /app

# Copier les dépendances Node et Python
COPY package*.json ./
COPY requirements.txt ./

# Installer les dépendances
RUN npm install
RUN npx prisma generate
RUN pip3 install --no-cache-dir -r requirements.txt

# Copier le reste du projet
COPY . .

# Exposer le port d'écoute (Render utilise automatiquement 10000)
EXPOSE 10000

# Démarrer l'application
CMD ["node", "server.js"]
