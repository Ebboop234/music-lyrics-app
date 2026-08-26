# ================================
# Stage 1: Build SongRec
# ================================

FROM rust:1.85-bookworm AS songrec-builder

RUN apt-get update && \
    apt-get install -y \
    libasound2-dev \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/SongRec

COPY SongRec/Cargo.toml SongRec/Cargo.lock ./
COPY SongRec/src ./src
COPY SongRec/build.rs ./

RUN cargo build --release


# ================================
# Stage 2: Run Music Lyrics App
# ================================

FROM node:22-bookworm

# Install FFmpeg and libraries needed by SongRec

RUN apt-get update && \
    apt-get install -y \
    ffmpeg \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*


WORKDIR /app


# Copy SongRec executable from builder

RUN mkdir -p /app/SongRec/target/release

COPY --from=songrec-builder \
    /app/SongRec/target/release/songrec \
    /app/SongRec/target/release/songrec


# Install Node dependencies

COPY package*.json ./

RUN npm install


# Copy the rest of the application

COPY . .


# Make sure uploads directory exists

RUN mkdir -p uploads


EXPOSE 3000


CMD ["node", "server.js"]