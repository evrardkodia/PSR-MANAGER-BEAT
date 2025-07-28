FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Installer les dépendances système
RUN apt-get update && apt-get install -y \
    timidity \
    python3 \
    python3-pip \
    nodejs \
    npm \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Créer dossier de travail
WORKDIR /app

# Copier les dépendances
COPY package*.json ./
COPY requirements.txt ./

# Installer les dépendances
RUN npm install
RUN pip3 install --no-cache-dir -r requirements.txt

# Copier tout le projet
COPY . .

# Exposer le port (Render utilise automatiquement le port 10000)
EXPOSE 10000

# Lancer l'application
CMD ["node", "server.js"]
