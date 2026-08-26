# ==========================================
# BUILD SONGREC
# ==========================================
FROM rust:1.88-bookworm AS songrec-builder

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    build-essential \
    pkg-config \
    libasound2-dev \
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

# Build SongRec without GUI, PipeWire, PulseAudio, MPRIS, or FFmpeg
RUN cargo build --release --no-default-features


# ==========================================
# NODE SERVER
# ==========================================
FROM node:22-bookworm

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