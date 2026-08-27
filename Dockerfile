# ==========================================
# BUILD SONGREC
# ==========================================
FROM ubuntu:26.04 AS songrec-builder

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    curl \
    build-essential \
    ffmpeg \
    pkg-config \
    git \
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
    libpulse-dev \
    libavcodec-dev \
    libavformat-dev \
    libavutil-dev \
    libswresample-dev \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# ==========================================
# INSTALL RUST
# ==========================================

RUN curl --proto '=https' \
    --tlsv1.2 \
    -sSf https://sh.rustup.rs \
    | sh -s -- -y --default-toolchain 1.88

ENV PATH="/root/.cargo/bin:${PATH}"

# ==========================================
# BUILD SONGREC
# ==========================================

WORKDIR /build

COPY SongRec/Cargo.toml SongRec/Cargo.lock* ./
COPY SongRec/src ./src
COPY SongRec/build.rs ./build.rs
COPY SongRec/packaging ./packaging
COPY SongRec/python-version ./python-version
COPY SongRec/translations ./translations

# IMPORTANT:
# soup3 is required by SongRec's fingerprinting code,
# so we keep it enabled.
#
# We disable the desktop GUI and other unnecessary
# desktop features, but keep FFmpeg for audio decoding.

RUN cargo build --release --no-default-features -F ffmpeg

# ==========================================
# NODE SERVER
# ==========================================

FROM node:22-bookworm
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

# Copy compiled SongRec executable
COPY --from=songrec-builder \
    /build/target/release/songrec \
    /app/SongRec/target/release/songrec

RUN mkdir -p uploads

ENV SONGREC_PATH=/app/SongRec/target/release/songrec

EXPOSE 3000

CMD ["node", "server.js"]
