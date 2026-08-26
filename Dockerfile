FROM node:22-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN curl -L https://github.com/acoustid/chromaprint/releases/download/v1.6.1/chromaprint-fpcalc-1.6.1-linux-x86_64.tar.gz \
    -o /tmp/fpcalc.tar.gz \
    && mkdir -p /opt/fpcalc \
    && tar -xzf /tmp/fpcalc.tar.gz -C /opt/fpcalc --strip-components=1 \
    && chmod +x /opt/fpcalc/fpcalc \
    && ln -s /opt/fpcalc/fpcalc /usr/local/bin/fpcalc \
    && rm /tmp/fpcalc.tar.gz

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]