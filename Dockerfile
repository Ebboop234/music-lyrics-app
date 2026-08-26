# ==========================================
# BUILD SONGREC WITHOUT GUI
# ==========================================
FROM rust:1.88-bookworm AS songrec-builder

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    build-essential \
    pkg-config \
    libasound2-dev \
    libpulse-dev \
    libssl-dev \
    libdbus-1-dev \
    libclang-dev \
    ffmpeg \
    gettext \
    sed \
    grep \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

COPY SongRec/Cargo.toml SongRec/Cargo.lock* ./
COPY SongRec/src ./src
COPY SongRec/build.rs ./build.rs
COPY SongRec/packaging ./packaging
COPY SongRec/python-version ./python-version
COPY SongRec/translations ./translations

# Build SongRec WITHOUT the GTK desktop GUI.
# We only need the command-line recognition functionality.
RUN cargo build --release --no-default-features -F ffmpeg


# ==========================================
# NODE SERVER
# ==========================================
FROM node:22-bookworm

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev

COPY . .

# Copy the SongRec command-line binary
COPY --from=songrec-builder \
    /build/target/release/songrec \
    /app/SongRec/target/release/songrec

RUN mkdir -p uploads

ENV SONGREC_PATH=/app/SongRec/target/release/songrec

EXPOSE 3000

CMD ["node", "server.js"]