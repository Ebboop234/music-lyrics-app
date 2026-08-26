FROM rust:1.85-bookworm AS songrec-builder

RUN apt-get update && apt-get install -y \
    pkg-config \
    libpipewire-0.3-dev \
    libasound2-dev \
    libsoup-3.0-dev \
    libglib2.0-dev \
    libsqlite3-dev \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build/SongRec

COPY SongRec/Cargo.toml SongRec/Cargo.lock ./
COPY SongRec/src ./src
COPY SongRec/build.rs ./
COPY SongRec/python-version ./python-version

RUN cargo build --release


FROM node:22-bookworm

RUN apt-get update && apt-get install -y \
    ffmpeg \
    libpipewire-0.3-0 \
    libasound2 \
    libsoup-3.0-0 \
    libglib2.0-0 \
    libsqlite3-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

COPY --from=songrec-builder \
    /build/SongRec/target/release/songrec \
    /app/SongRec/target/release/songrec

RUN chmod +x /app/SongRec/target/release/songrec
RUN mkdir -p uploads

EXPOSE 3000

CMD ["node", "server.js"]