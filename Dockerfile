# ---------- SongRec build ----------
FROM rust:1.88-bookworm AS songrec-builder

RUN apt-get update && apt-get install -y \
    build-essential \
    pkg-config \
    libgtk-4-dev \
    libadwaita-1-dev \
    libpipewire-0.3-dev \
    libasound2-dev \
    libsoup-3.0-dev \
    libglib2.0-dev \
    libssl-dev \
    libsqlite3-dev \
    libdbus-1-dev \
    libudev-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

COPY SongRec/Cargo.toml SongRec/Cargo.lock* ./
COPY SongRec/src ./src
COPY SongRec/build.rs ./build.rs
COPY SongRec/packaging ./packaging
COPY SongRec/python-version ./python-version
COPY SongRec/translations ./translations

RUN cargo build --release


# ---------- Node server ----------
FROM node:22-bookworm

RUN apt-get update && apt-get install -y \
    libgtk-4-1 \
    libadwaita-1-0 \
    libpipewire-0.3-0 \
    libasound2 \
    libsoup-3.0-0 \
    libglib2.0-0 \
    libsqlite3-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

COPY --from=songrec-builder \
    /build/target/release/songrec \
    /app/SongRec/target/release/songrec

RUN mkdir -p uploads

ENV SONGREC_PATH=/app/SongRec/target/release/songrec

EXPOSE 3000

CMD ["node", "server.js"]