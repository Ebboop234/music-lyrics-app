# ================================
# Build SongRec
# ================================
FROM ubuntu:24.04 AS songrec-builder

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    curl \
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
    git \
    && rm -rf /var/lib/apt/lists/*

# Install Rust 1.88
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --default-toolchain 1.88

ENV PATH="/root/.cargo/bin:${PATH}"

WORKDIR /build

COPY SongRec/Cargo.toml SongRec/Cargo.lock* ./
COPY SongRec/src ./src
COPY SongRec/build.rs ./build.rs
COPY SongRec/packaging ./packaging
COPY SongRec/python-version ./python-version
COPY SongRec/translations ./translations

RUN cargo build --release


# ================================
# Node server
# ================================
FROM node:22-bookworm

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

# Copy the compiled SongRec program
COPY --from=songrec-builder \
    /build/target/release/songrec \
    /app/SongRec/target/release/songrec

RUN mkdir -p uploads

ENV SONGREC_PATH=/app/SongRec/target/release/songrec

EXPOSE 3000

CMD ["node", "server.js"]