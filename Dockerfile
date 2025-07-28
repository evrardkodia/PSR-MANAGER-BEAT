FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    timidity \
    sox \
    nodejs \
    npm \
    python3 \
    python3-pip \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
