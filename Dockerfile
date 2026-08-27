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
    clang \
    libclang-dev \
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

RUN cargo build --release --no-default-features -F ffmpeg

# ==========================================
# NODE SERVER
# ==========================================

FROM ubuntu:26.04

ENV DEBIAN_FRONTEND=noninteractive

# Install runtime libraries + Node.js
RUN apt-get update && apt-get install -y \
    curl \
    ca-certificates \
    ffmpeg \
    libsoup-3.0-0 \
    libgtk-4-1 \
    libadwaita-1-0 \
    libpipewire-0.3-0 \
    libasound2t64 \
    libpulse0 \
    libglib2.0-0 \
    libssl3 \
    libsqlite3-0 \
    libdbus-1-3 \
    libudev1 \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# ==========================================
# NODE APP
# ==========================================

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

# ==========================================
# COPY SONGREC
# ==========================================

COPY --from=songrec-builder \
    /build/target/release/songrec \
    /app/SongRec/target/release/songrec

RUN mkdir -p uploads

ENV SONGREC_PATH=/app/SongRec/target/release/songrec

EXPOSE 3000

CMD ["node", "server.js"]