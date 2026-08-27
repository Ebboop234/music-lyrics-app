require("dotenv").config();

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3000;

const uploadDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

app.use(express.static(__dirname));

const upload = multer({
    dest: uploadDir
});

/* =========================================================
   HELPERS
========================================================= */

function cleanText(value) {
    if (!value) return "";

    return String(value)
        .replace(/\s+/g, " ")
        .trim();
}

function escapeRegex(value) {
    return String(value).replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
    );
}

/* =========================================================
   CONVERT AUDIO TO WAV
========================================================= */

function convertToWav(inputFile, outputFile) {
    return new Promise((resolve, reject) => {
        execFile(
            "ffmpeg",
            [
                "-y",
                "-i",
                inputFile,
                "-vn",
                "-ac",
                "1",
                "-ar",
                "44100",
                "-sample_fmt",
                "s16",
                outputFile
            ],
            {
                timeout: 60000,
                maxBuffer: 10 * 1024 * 1024
            },
            (error, stdout, stderr) => {
                if (error) {
                    console.error(
                        "FFmpeg error:",
                        stderr || error.message
                    );

                    reject(
                        new Error(
                            "Audio conversion failed: " +
                            (stderr || error.message)
                        )
                    );

                    return;
                }

                resolve();
            }
        );
    });
}

/* =========================================================
   FIND SONGREC
========================================================= */

function getSongRecPath() {
    const configuredPath =
        process.env.SONGREC_PATH;

    if (
        configuredPath &&
        fs.existsSync(configuredPath)
    ) {
        return configuredPath;
    }

    const possiblePaths = [
        path.join(
            __dirname,
            "SongRec",
            "target",
            "release",
            "songrec"
        ),

        "/app/SongRec/target/release/songrec",

        path.join(
            process.cwd(),
            "SongRec",
            "target",
            "release",
            "songrec"
        )
    ];

    for (const candidate of possiblePaths) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return null;
}

/* =========================================================
   RUN SONGREC / SHAZAM
========================================================= */

function runSongRec(wavFile) {
    return new Promise((resolve, reject) => {
        const songrec = getSongRecPath();

        if (!songrec) {
            reject(
                new Error(
                    "SongRec executable not found."
                )
            );

            return;
        }

        console.log(
            "🎵 Running SongRec:",
            songrec
        );

        const env = {
            ...process.env
        };

        execFile(
            songrec,
            [
                "recognize",
                "-j",
                wavFile
            ],
            {
                env,
                timeout: 60000,
                maxBuffer: 20 * 1024 * 1024
            },
            (error, stdout, stderr) => {
                console.log(
                    "SongRec stdout:",
                    stdout
                );

                if (stderr) {
                    console.log(
                        "SongRec stderr:",
                        stderr
                    );
                }

                if (error) {
                    console.error(
                        "SongRec error:",
                        error.message
                    );

                    reject(
                        new Error(
                            stderr ||
                            error.message ||
                            "SongRec failed."
                        )
                    );

                    return;
                }

                resolve(stdout);
            }
        );
    });
}

/* =========================================================
   EXTRACT JSON
========================================================= */

function extractJson(text) {
    if (!text) {
        return null;
    }

    text = text.trim();

    try {
        return JSON.parse(text);
    } catch (error) {
        // Continue.
    }

    const firstBrace =
        text.indexOf("{");

    const lastBrace =
        text.lastIndexOf("}");

    if (
        firstBrace !== -1 &&
        lastBrace !== -1 &&
        lastBrace > firstBrace
    ) {
        const possibleJson =
            text.substring(
                firstBrace,
                lastBrace + 1
            );

        try {
            return JSON.parse(
                possibleJson
            );
        } catch (error) {
            console.error(
                "JSON extraction failed:",
                error.message
            );
        }
    }

    return null;
}

/* =========================================================
   FIND TRACK
========================================================= */

function findTrack(data) {
    if (!data) {
        return null;
    }

    if (
        data.track &&
        typeof data.track === "object"
    ) {
        return data.track;
    }

    if (
        Array.isArray(data.matches) &&
        data.matches.length > 0
    ) {
        return data.matches[0];
    }

    function search(object) {
        if (
            !object ||
            typeof object !== "object"
        ) {
            return null;
        }

        if (
            typeof object.title === "string" &&
            (
                typeof object.subtitle === "string" ||
                typeof object.artist === "string"
            )
        ) {
            return object;
        }

        for (
            const key of Object.keys(object)
        ) {
            const result =
                search(object[key]);

            if (result) {
                return result;
            }
        }

        return null;
    }

    return search(data);
}

/* =========================================================
   FIND MATCH POSITION
========================================================= */

function findMatchPosition(data) {
    if (!data) {
        return 0;
    }

    const possibleKeys = [
        "offset",
        "matchOffset",
        "matchPosition",
        "position"
    ];

    function search(object) {
        if (
            !object ||
            typeof object !== "object"
        ) {
            return null;
        }

        for (
            const key of possibleKeys
        ) {
            if (
                typeof object[key] === "number"
            ) {
                return object[key];
            }
        }

        for (
            const key of Object.keys(object)
        ) {
            const result =
                search(object[key]);

            if (
                typeof result === "number"
            ) {
                return result;
            }
        }

        return null;
    }

    return search(data) || 0;
}

/* =========================================================
   FIND ALBUM
========================================================= */

function findAlbum(data) {
    if (!data) {
        return "";
    }

    function search(object) {
        if (
            !object ||
            typeof object !== "object"
        ) {
            return "";
        }

        if (
            Array.isArray(object.metadata)
        ) {
            for (
                const item of object.metadata
            ) {
                if (
                    item &&
                    item.title === "Album" &&
                    typeof item.text === "string"
                ) {
                    return item.text;
                }
            }
        }

        for (
            const key of Object.keys(object)
        ) {
            const result =
                search(object[key]);

            if (result) {
                return result;
            }
        }

        return "";
    }

    return search(data);
}

/* =========================================================
   FIND ARTWORK
========================================================= */

function findArtwork(data) {
    if (!data) {
        return "";
    }

    const possibleKeys = [
        "coverart",
        "coverArt",
        "artwork",
        "image",
        "avatar"
    ];

    function search(object) {
        if (
            !object ||
            typeof object !== "object"
        ) {
            return "";
        }

        for (
            const key of possibleKeys
        ) {
            if (
                typeof object[key] === "string" &&
                object[key].startsWith("http")
            ) {
                return object[key];
            }
        }

        for (
            const key of Object.keys(object)
        ) {
            const result =
                search(object[key]);

            if (result) {
                return result;
            }
        }

        return "";
    }

    return search(data);
}

/* =========================================================
   NORMALIZE TITLE / ARTIST
========================================================= */

function normalizeSongText(text) {
    return cleanText(text)
        .replace(
            /\([^)]*\)/g,
            ""
        )
        .replace(
            /\[[^\]]*\]/g,
            ""
        )
        .replace(
            /\s+/g,
            " "
        )
        .trim();
}

/* =========================================================
   LRCLIB
========================================================= */

async function getLrcLibLyrics(
    title,
    artist,
    album = ""
) {
    try {
        console.log(
            "🔎 Trying LRCLIB..."
        );

        const params =
            new URLSearchParams();

        params.set(
            "track_name",
            title
        );

        params.set(
            "artist_name",
            artist
        );

        if (album) {
            params.set(
                "album_name",
                album
            );
        }

        const url =
            "https://lrclib.net/api/get?" +
            params.toString();

        const response =
            await fetch(url, {
                headers: {
                    "User-Agent":
                        "Music-Lyrics-App/1.0"
                }
            });

        if (!response.ok) {
            console.log(
                "LRCLIB status:",
                response.status
            );

            return null;
        }

        const result =
            await response.json();

        if (!result) {
            return null;
        }

        if (
            result.syncedLyrics &&
            typeof result.syncedLyrics === "string"
        ) {
            console.log(
                "✅ LRCLIB synchronized lyrics found."
            );

            return {
                syncedLyrics:
                    result.syncedLyrics,
                plainLyrics:
                    result.plainLyrics || null,
                source: "lrclib"
            };
        }

        if (
            result.plainLyrics &&
            typeof result.plainLyrics === "string"
        ) {
            console.log(
                "✅ LRCLIB plain lyrics found."
            );

            return {
                syncedLyrics: null,
                plainLyrics:
                    result.plainLyrics,
                source: "lrclib"
            };
        }

    } catch (error) {
        console.error(
            "LRCLIB error:",
            error.message
        );
    }

    return null;
}

/* =========================================================
   LYRICS.OVH
========================================================= */

async function getLyricsOvh(
    title,
    artist
) {
    try {
        console.log(
            "🔎 Trying lyrics.ovh..."
        );

        const artistEncoded =
            encodeURIComponent(
                artist
            );

        const titleEncoded =
            encodeURIComponent(
                title
            );

        const url =
            `https://api.lyrics.ovh/v1/${artistEncoded}/${titleEncoded}`;

        const response =
            await fetch(url);

        if (!response.ok) {
            console.log(
                "lyrics.ovh status:",
                response.status
            );

            return null;
        }

        const result =
            await response.json();

        if (
            result &&
            result.lyrics
        ) {
            console.log(
                "✅ lyrics.ovh plain lyrics found."
            );

            return {
                syncedLyrics: null,
                plainLyrics:
                    result.lyrics,
                source: "lyrics.ovh"
            };
        }

    } catch (error) {
        console.error(
            "lyrics.ovh error:",
            error.message
        );
    }

    return null;
}

/* =========================================================
   CONVERT PLAIN LYRICS TO ESTIMATED SYNC
========================================================= */

function createEstimatedSyncedLyrics(
    plainLyrics,
    matchPosition = 0
) {
    if (
        !plainLyrics ||
        typeof plainLyrics !== "string"
    ) {
        return null;
    }

    const lines =
        plainLyrics
            .split(/\r?\n/)
            .map(line =>
                cleanText(line)
            )
            .filter(Boolean);

    if (lines.length === 0) {
        return null;
    }

    /*
     * We don't know the real timing when
     * the lyrics source only gives plain text.
     *
     * Instead we create a smooth estimated
     * timeline.
     *
     * This allows the front end to highlight
     * and scroll lyrics instead of displaying
     * everything at once.
     */

    const averageSecondsPerLine =
        3.4;

    /*
     * Start a little before the detected
     * Shazam position so the first visible
     * lyric isn't unnecessarily far ahead.
     */

    let startTime =
        Math.max(
            0,
            Number(matchPosition) - 8
        );

    /*
     * Remove obvious section labels from
     * the timing calculation.
     */

    const result = [];

    let lyricTime =
        startTime;

    for (
        let i = 0;
        i < lines.length;
        i++
    ) {
        const line =
            lines[i];

        /*
         * Slightly longer pauses for blank/
         * section-like lines are not needed
         * because empty lines were removed.
         */

        const minutes =
            Math.floor(
                lyricTime / 60
            );

        const seconds =
            lyricTime % 60;

        const timestamp =
            `[${String(minutes).padStart(2, "0")}:${seconds.toFixed(2).padStart(5, "0")}]`;

        result.push(
            timestamp +
            line
        );

        /*
         * Longer lyric lines get a little
         * more time.
         */

        const wordCount =
            line.split(/\s+/).length;

        let duration =
            averageSecondsPerLine;

        if (wordCount > 12) {
            duration += 0.8;
        }

        if (wordCount > 20) {
            duration += 1.0;
        }

        lyricTime += duration;
    }

    return result.join("\n");
}

/* =========================================================
   CLEAN / VALIDATE SYNCED LYRICS
========================================================= */

function cleanSyncedLyrics(text) {
    if (
        !text ||
        typeof text !== "string"
    ) {
        return null;
    }

    const lines =
        text.split(/\r?\n/);

    const valid = [];

    for (
        const line of lines
    ) {
        const match =
            line.match(
                /^\s*\[(\d+):(\d+(?:\.\d+)?)\](.*)$/
            );

        if (!match) {
            continue;
        }

        const textPart =
            cleanText(match[3]);

        if (!textPart) {
            continue;
        }

        valid.push(
            line.trim()
        );
    }

    if (valid.length === 0) {
        return null;
    }

    return valid.join("\n");
}

/* =========================================================
   GET LYRICS
========================================================= */

async function getLyrics(
    title,
    artist,
    album,
    matchPosition
) {
    const cleanTitle =
        normalizeSongText(
            title
        );

    const cleanArtist =
        normalizeSongText(
            artist
        );

    console.log(
        "📖 Lyrics search:",
        cleanTitle,
        "—",
        cleanArtist
    );

    /*
     * -----------------------------------------
     * 1. LRCLIB
     * -----------------------------------------
     */

    let result =
        await getLrcLibLyrics(
            cleanTitle,
            cleanArtist,
            album
        );

    if (result) {
        if (
            result.syncedLyrics
        ) {
            const cleaned =
                cleanSyncedLyrics(
                    result.syncedLyrics
                );

            if (cleaned) {
                return {
                    syncedLyrics:
                        cleaned,
                    estimated: false,
                    source:
                        result.source
                };
            }
        }

        if (
            result.plainLyrics
        ) {
            const estimated =
                createEstimatedSyncedLyrics(
                    result.plainLyrics,
                    matchPosition
                );

            if (estimated) {
                return {
                    syncedLyrics:
                        estimated,
                    estimated: true,
                    source:
                        result.source
                };
            }
        }
    }

    /*
     * -----------------------------------------
     * 2. lyrics.ovh
     * -----------------------------------------
     */

    result =
        await getLyricsOvh(
            cleanTitle,
            cleanArtist
        );

    if (result) {
        if (
            result.plainLyrics
        ) {
            const estimated =
                createEstimatedSyncedLyrics(
                    result.plainLyrics,
                    matchPosition
                );

            if (estimated) {
                return {
                    syncedLyrics:
                        estimated,
                    estimated: true,
                    source:
                        result.source
                };
            }
        }
    }

    /*
     * -----------------------------------------
     * 3. AUDD, if configured
     * -----------------------------------------
     */

    const token =
        process.env.AUDD_TOKEN ||
        process.env.AUDD_API_TOKEN;

    if (token) {
        try {
            console.log(
                "🔎 Trying AUDD..."
            );

            const params =
                new URLSearchParams();

            params.append(
                "api_token",
                token
            );

            params.append(
                "q",
                `${cleanTitle} ${cleanArtist}`
            );

            const response =
                await fetch(
                    "https://api.audd.io/",
                    {
                        method: "POST",
                        headers: {
                            "Content-Type":
                                "application/x-www-form-urlencoded"
                        },
                        body: params
                    }
                );

            if (response.ok) {
                const data =
                    await response.json();

                const lyrics =
                    data?.result?.lyrics;

                if (lyrics) {
                    const estimated =
                        createEstimatedSyncedLyrics(
                            lyrics,
                            matchPosition
                        );

                    if (estimated) {
                        console.log(
                            "✅ AUDD lyrics found and estimated timing created."
                        );

                        return {
                            syncedLyrics:
                                estimated,
                            estimated: true,
                            source: "audd"
                        };
                    }
                }
            }

        } catch (error) {
            console.error(
                "AUDD error:",
                error.message
            );
        }
    }

    /*
     * Nothing worked.
     */

    return null;
}

/* =========================================================
   IDENTIFY ENDPOINT
========================================================= */

app.post(
    "/identify-shazam",
    upload.single("audio"),
    async (req, res) => {
        let inputFile = null;
        let wavFile = null;

        try {
            if (!req.file) {
                return res.status(400).json({
                    error:
                        "No audio file received."
                });
            }

            inputFile =
                req.file.path;

            console.log(
                "🎤 Received audio:",
                inputFile
            );

            /*
             * ---------------------------------
             * Convert audio
             * ---------------------------------
             */

            wavFile =
                path.join(
                    uploadDir,
                    req.file.filename +
                    ".wav"
                );

            console.log(
                "🔄 Converting audio to WAV..."
            );

            await convertToWav(
                inputFile,
                wavFile
            );

            console.log(
                "✅ WAV ready."
            );

            /*
             * ---------------------------------
             * SongRec
             * ---------------------------------
             */

            const stdout =
                await runSongRec(
                    wavFile
                );

            const shazamData =
                extractJson(
                    stdout
                );

            if (!shazamData) {
                return res.status(500).json({
                    error:
                        "Could not read SongRec/Shazam result."
                });
            }

            /*
             * ---------------------------------
             * Track
             * ---------------------------------
             */

            const track =
                findTrack(
                    shazamData
                );

            if (!track) {
                return res.status(404).json({
                    error:
                        "Song information was not returned."
                });
            }

            const title =
                cleanText(
                    track.title ||
                    track.name ||
                    "Unknown Song"
                );

            const artist =
                cleanText(
                    track.subtitle ||
                    track.artist ||
                    "Unknown Artist"
                );

            const album =
                findAlbum(
                    shazamData
                );

            const artwork =
                findArtwork(
                    shazamData
                );

            /*
             * ---------------------------------
             * Match position
             * ---------------------------------
             */

            let matchPosition =
                Number(
                    findMatchPosition(
                        shazamData
                    )
                );

            if (
                !Number.isFinite(
                    matchPosition
                ) ||
                matchPosition < 0
            ) {
                matchPosition = 0;
            }

            console.log(
                "🎵 Song:",
                title
            );

            console.log(
                "👤 Artist:",
                artist
            );

            console.log(
                "💿 Album:",
                album || "Unknown"
            );

            console.log(
                "🖼️ Artwork:",
                artwork || "None"
            );

            console.log(
                "🎯 Match position:",
                matchPosition
            );

            /*
             * ---------------------------------
             * Lyrics
             * ---------------------------------
             */

            console.log(
                "📖 Looking for lyrics..."
            );

            const lyrics =
                await getLyrics(
                    title,
                    artist,
                    album,
                    matchPosition
                );

            if (lyrics) {
                console.log(
                    "✅ Lyrics ready.",
                    "Source:",
                    lyrics.source,
                    "Estimated:",
                    lyrics.estimated
                );
            } else {
                console.log(
                    "⚠️ No lyrics found."
                );
            }

            /*
             * ---------------------------------
             * Return result
             * ---------------------------------
             */

            return res.json({
                success: true,

                song: {
                    title:
                        title,

                    artist:
                        artist,

                    album:
                        album,

                    artwork:
                        artwork,

                    matchPosition:
                        matchPosition,

                    timecode:
                        matchPosition
                },

                lyrics:
                    lyrics
                        ? {
                            syncedLyrics:
                                lyrics.syncedLyrics,

                            estimated:
                                lyrics.estimated,

                            source:
                                lyrics.source
                        }
                        : null
            });

        } catch (error) {
            console.error(
                "❌ SERVER ERROR:",
                error
            );

            return res.status(500).json({
                error:
                    "Server error: " +
                    error.message
            });

        } finally {
            /*
             * ---------------------------------
             * Cleanup
             * ---------------------------------
             */

            try {
                if (
                    inputFile &&
                    fs.existsSync(
                        inputFile
                    )
                ) {
                    fs.unlinkSync(
                        inputFile
                    );
                }

                if (
                    wavFile &&
                    fs.existsSync(
                        wavFile
                    )
                ) {
                    fs.unlinkSync(
                        wavFile
                    );
                }

            } catch (cleanupError) {
                console.error(
                    "Cleanup error:",
                    cleanupError.message
                );
            }
        }
    }
);

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get(
    "/health",
    (req, res) => {
        const songrecPath =
            getSongRecPath();

        let ffmpegInstalled =
            false;

        try {
            const { execFileSync } =
                require("child_process");

            execFileSync(
                "ffmpeg",
                ["-version"],
                {
                    stdio: "ignore"
                }
            );

            ffmpegInstalled = true;

        } catch (error) {
            ffmpegInstalled = false;
        }

        res.json({
            status: "ok",

            songrec:
                !!songrecPath,

            songrecPath:
                songrecPath || null,

            ffmpeg:
                ffmpegInstalled,

            lyricsSources: [
                "LRCLIB",
                "lyrics.ovh",
                "AUDD-if-configured"
            ]
        });
    }
);

/* =========================================================
   START SERVER
========================================================= */

app.listen(
    PORT,
    () => {
        console.log(
            `🎵 Music Lyrics server running on port ${PORT}`
        );

        console.log(
            "🎤 SongRec:",
            getSongRecPath() ||
            "NOT FOUND"
        );
    }
);