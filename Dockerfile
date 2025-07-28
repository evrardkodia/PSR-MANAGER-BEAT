FROM node:18-bullseye

# Installer curl, timidity, python3, pip3, nodejs et npm (npm & nodejs déjà dans node:18 mais on peut assurer)
RUN apt-get update && apt-get install -y \
    curl \
    timidity \
    python3 \
    python3-pip \
    nodejs \
    npm \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copier les fichiers de dépendances
COPY package*.json ./
COPY requirements.txt ./

# Installer dépendances Node.js et Prisma
RUN npm install
RUN npx prisma generate

# Installer dépendances Python
RUN pip3 install --no-cache-dir -r requirements.txt

# Copier le reste du projet
COPY . .

EXPOSE 10000

CMD ["node", "server.js"]
