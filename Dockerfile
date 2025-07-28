FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Installer les dépendances système de base (sans nodejs ni npm)
RUN apt-get update && apt-get install -y \
    curl \
    timidity \
    python3 \
    python3-pip \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Installer Node.js 18 officiel depuis Nodesource
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copier les fichiers de dépendances
COPY package*.json ./
COPY requirements.txt ./

# Installer les dépendances Node et Python
RUN npm install
RUN pip3 install --no-cache-dir -r requirements.txt

# Copier tout le code
COPY . .

EXPOSE 10000

CMD ["node", "server.js"]
