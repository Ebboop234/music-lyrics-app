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

/* =====================================================
   FFMPEG
===================================================== */

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
                    console.error("FFmpeg error:", stderr);

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

/* =====================================================
   SONGREC
===================================================== */

function runSongRec(wavFile) {
    return new Promise((resolve, reject) => {

        const songrec = path.join(
            __dirname,
            "SongRec",
            "target",
            "release",
            "songrec"
        );

        if (!fs.existsSync(songrec)) {
            reject(
                new Error(
                    "SongRec executable not found: " +
                    songrec
                )
            );

            return;
        }

        console.log("Running SongRec:", songrec);

        execFile(
            songrec,
            [
                "recognize",
                "-j",
                wavFile
            ],
            {
                timeout: 60000,
                maxBuffer: 20 * 1024 * 1024
            },
            (error, stdout, stderr) => {

                console.log(
                    "SongRec stdout:",
                    stdout
                );

                console.log(
                    "SongRec stderr:",
                    stderr
                );

                if (error) {
                    reject(
                        new Error(
                            stderr ||
                            error.message ||
                            "SongRec failed"
                        )
                    );

                    return;
                }

                resolve(stdout);
            }
        );
    });
}

/* =====================================================
   JSON
===================================================== */

function extractJson(text) {

    if (!text) {
        return null;
    }

    text = text.trim();

    try {
        return JSON.parse(text);
    } catch (_) {}

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
                "JSON parse error:",
                error.message
            );
        }
    }

    return null;
}

/* =====================================================
   TRACK
===================================================== */

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
        data.matches.length
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

/* =====================================================
   ALBUM
===================================================== */

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

/* =====================================================
   ARTWORK
===================================================== */

function findArtwork(data) {

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

        const keys = [
            "coverart",
            "coverArt",
            "artwork",
            "image",
            "avatar"
        ];

        for (
            const key of keys
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

/* =====================================================
   MATCH POSITION
===================================================== */

function findMatchPosition(data) {

    if (!data) {
        return 0;
    }

    const keys = [
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
            const key of keys
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

/* =====================================================
   LYRICS
===================================================== */

async function getLyrics(title, artist) {

    const token =
        process.env.AUDD_TOKEN ||
        process.env.AUDD_API_TOKEN;

    if (!token) {
        console.log(
            "No AUDD token configured."
        );

        return null;
    }

    try {

        const params =
            new URLSearchParams();

        params.append(
            "api_token",
            token
        );

        params.append(
            "q",
            `${title} ${artist}`
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

        const result =
            await response.json();

        console.log(
            "AUDD result received."
        );

        if (
            !result ||
            !result.result
        ) {
            return null;
        }

        const r =
            result.result;

        /*
         * IMPORTANT:
         *
         * We ONLY call lyrics synchronized
         * if they actually contain timestamps.
         */

        let syncedLyrics = null;

        if (
            typeof r.syncedLyrics === "string" &&
            r.syncedLyrics.includes("[")
        ) {
            syncedLyrics =
                r.syncedLyrics;
        }

        /*
         * Some APIs may put synced lyrics
         * in another field.
         */

        if (
            !syncedLyrics &&
            typeof r.lyrics === "string" &&
            r.lyrics.includes("[")
        ) {
            syncedLyrics =
                r.lyrics;
        }

        if (!syncedLyrics) {

            console.log(
                "Lyrics received, but they are NOT timestamped."
            );

            return {
                syncedLyrics: null,
                plainLyrics:
                    r.lyrics || null
            };
        }

        console.log(
            "✅ Timestamped lyrics found."
        );

        return {
            syncedLyrics
        };

    } catch (error) {

        console.error(
            "Lyrics error:",
            error.message
        );

        return null;
    }
}

/* =====================================================
   IDENTIFY
===================================================== */

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

            wavFile =
                path.join(
                    uploadDir,
                    req.file.filename +
                    ".wav"
                );

            console.log(
                "🎤 Received audio"
            );

            await convertToWav(
                inputFile,
                wavFile
            );

            console.log(
                "✅ Audio converted"
            );

            const stdout =
                await runSongRec(
                    wavFile
                );

            const shazamData =
                extractJson(stdout);

            if (!shazamData) {

                return res.status(500).json({
                    error:
                        "Could not read SongRec result."
                });
            }

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
                track.title ||
                track.name ||
                "Unknown Song";

            const artist =
                track.subtitle ||
                track.artist ||
                "Unknown Artist";

            const album =
                findAlbum(
                    shazamData
                );

            const artwork =
                findArtwork(
                    shazamData
                );

            const matchPosition =
                findMatchPosition(
                    shazamData
                );

            console.log(
                "🎵",
                title,
                "—",
                artist
            );

            console.log(
                "🎯 Match position:",
                matchPosition
            );

            /*
             * Get lyrics
             */

            const lyrics =
                await getLyrics(
                    title,
                    artist
                );

            /*
             * Return everything
             */

            return res.json({

                success: true,

                song: {

                    title,

                    artist,

                    album,

                    artwork,

                    /*
                     * SEND BOTH NAMES.
                     *
                     * This prevents the old frontend
                     * from accidentally reading 0.
                     */

                    matchPosition,

                    matchOffset:
                        matchPosition,

                    timecode:
                        matchPosition
                },

                lyrics
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

            try {

                if (
                    inputFile &&
                    fs.existsSync(inputFile)
                ) {
                    fs.unlinkSync(
                        inputFile
                    );
                }

                if (
                    wavFile &&
                    fs.existsSync(wavFile)
                ) {
                    fs.unlinkSync(
                        wavFile
                    );
                }

            } catch (error) {

                console.error(
                    "Cleanup error:",
                    error.message
                );
            }
        }
    }
);

/* =====================================================
   HEALTH
===================================================== */

app.get(
    "/health",
    (req, res) => {

        const songrec =
            path.join(
                __dirname,
                "SongRec",
                "target",
                "release",
                "songrec"
            );

        res.json({

            status: "ok",

            songrec:
                fs.existsSync(
                    songrec
                ),

            ffmpeg: true

        });
    }
);

/* =====================================================
   START
===================================================== */

app.listen(
    PORT,
    () => {

        console.log(
            `🎵 Music Lyrics server running on port ${PORT}`
        );
    }
);