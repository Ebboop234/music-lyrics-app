require("dotenv").config();

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const app = express();

const PORT = process.env.PORT || 3000;

const uploadDir = path.join(__dirname, "uploads");
const libsDir = path.join(__dirname, "libs");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

app.use(express.static(__dirname));

const upload = multer({
    dest: uploadDir
});


/* =========================================
   CONVERT AUDIO TO WAV
   ========================================= */

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


/* =========================================
   RUN SONGREC
   ========================================= */

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
                    "SongRec executable not found at: " +
                    songrec
                )
            );

            return;
        }

        console.log(
            "Running SongRec:",
            songrec
        );

        /*
         * Render does not have the audio libraries
         * that SongRec needs.
         *
         * We bundled them in /libs.
         */

        const env = {
            ...process.env,
            LD_LIBRARY_PATH:
                libsDir +
                ":" +
                (process.env.LD_LIBRARY_PATH || "")
        };

        execFile(
            songrec,
            [
                "recognize",
                "-j",
                wavFile
            ],
            {
                env: env,
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

                    console.error(
                        "SongRec error:",
                        error
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


/* =========================================
   FIND JSON INSIDE SONGREC OUTPUT
   ========================================= */

function extractJson(text) {

    if (!text) {
        return null;
    }

    text = text.trim();

    /*
     * First try the entire output.
     */

    try {
        return JSON.parse(text);
    } catch (error) {
        // Continue below.
    }

    /*
     * SongRec can sometimes print other
     * information before the JSON.
     *
     * Find the first { and last }.
     */

    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");

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
            return JSON.parse(possibleJson);
        } catch (error) {
            console.error(
                "Could not parse extracted JSON:",
                error.message
            );
        }
    }

    return null;
}


/* =========================================
   FIND SONG INFORMATION
   ========================================= */

function findTrack(data) {

    if (!data) {
        return null;
    }

    /*
     * Normal SongRec/Shazam response.
     */

    if (
        data.track &&
        typeof data.track === "object"
    ) {
        return data.track;
    }

    /*
     * Some versions return a collection.
     */

    if (
        data.matches &&
        Array.isArray(data.matches) &&
        data.matches.length > 0
    ) {
        return data.matches[0];
    }

    /*
     * Search recursively for an object
     * containing title and subtitle.
     */

    function search(object) {

        if (!object || typeof object !== "object") {
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

        for (const key of Object.keys(object)) {

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


/* =========================================
   EXTRACT SHAZAM MATCH POSITION
   ========================================= */

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

        if (!object || typeof object !== "object") {
            return null;
        }

        for (const key of possibleKeys) {

            if (
                typeof object[key] === "number" &&
                object[key] > 0
            ) {
                return object[key];
            }
        }

        for (const key of Object.keys(object)) {

            const result =
                search(object[key]);

            if (
                typeof result === "number" &&
                result > 0
            ) {
                return result;
            }
        }

        return null;
    }

    return search(data) || 0;
}


/* =========================================
   EXTRACT ALBUM
   ========================================= */

function findAlbum(data) {

    if (!data) {
        return "";
    }

    function search(object) {

        if (!object || typeof object !== "object") {
            return "";
        }

        /*
         * Shazam commonly stores album information
         * inside sections.metadata.
         */

        if (
            Array.isArray(object.metadata)
        ) {

            for (const item of object.metadata) {

                if (
                    item &&
                    item.title === "Album" &&
                    typeof item.text === "string"
                ) {
                    return item.text;
                }
            }
        }

        for (const key of Object.keys(object)) {

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


/* =========================================
   EXTRACT ARTWORK
   ========================================= */

function findArtwork(data) {

    if (!data) {
        return "";
    }

    function search(object) {

        if (!object || typeof object !== "object") {
            return "";
        }

        /*
         * Common Shazam image fields.
         */

        const possibleKeys = [
            "coverart",
            "coverArt",
            "artwork",
            "image",
            "avatar"
        ];

        for (const key of possibleKeys) {

            if (
                typeof object[key] === "string" &&
                object[key].startsWith("http")
            ) {
                return object[key];
            }
        }

        for (const key of Object.keys(object)) {

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


/* =========================================
   LYRICS
   ========================================= */

async function getLyrics(title, artist) {

    /*
     * AUDD credentials are optional.
     *
     * If AUDD is configured, try it first.
     */

    const token =
        process.env.AUDD_TOKEN ||
        process.env.AUDD_API_TOKEN;

    if (token) {

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

            if (
                result &&
                result.result
            ) {

                const syncedLyrics =
                    result.result.apple_music?.url
                        ? null
                        : (
                            result.result
                                .syncedLyrics ||
                            result.result
                                .lyrics ||
                            null
                        );

                if (syncedLyrics) {

                    return {
                        syncedLyrics:
                            syncedLyrics
                    };
                }
            }

        } catch (error) {

            console.error(
                "AUDD lyrics error:",
                error.message
            );
        }
    }

    /*
     * No lyrics found through the available source.
     */

    return null;
}


/* =========================================
   IDENTIFY SONG
   ========================================= */

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

            inputFile = req.file.path;

            console.log(
                "Received audio:",
                inputFile
            );


            /* -------------------------
               Convert to WAV
               ------------------------- */

            wavFile =
                path.join(
                    uploadDir,
                    req.file.filename +
                    ".wav"
                );

            console.log(
                "Converting audio to WAV..."
            );

            await convertToWav(
                inputFile,
                wavFile
            );

            console.log(
                "WAV ready:",
                wavFile
            );


            /* -------------------------
               Recognize with SongRec
               ------------------------- */

            const stdout =
                await runSongRec(
                    wavFile
                );


            const shazamData =
                extractJson(stdout);


            if (!shazamData) {

                console.error(
                    "SongRec returned no readable JSON."
                );

                return res.status(500).json({
                    error:
                        "Could not read Shazam result."
                });

            }


            /* -------------------------
               Find track
               ------------------------- */

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


            /*
             * This is the actual position
             * where Shazam recognized the song.
             */

            const matchPosition =
                findMatchPosition(
                    shazamData
                );


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
                "⏱️ Shazam match position:",
                matchPosition,
                "seconds"
            );


            /* -------------------------
               Lyrics
               ------------------------- */

            console.log(
                "📖 Looking for lyrics..."
            );

            const lyrics =
                await getLyrics(
                    title,
                    artist
                );


            if (lyrics) {

                console.log(
                    "✅ Lyrics found."
                );

            } else {

                console.log(
                    "⚠️ No lyrics found."
                );

            }


            /* -------------------------
               Send result
               ------------------------- */

            return res.json({

                success: true,

                song: {

                    title: title,

                    artist: artist,

                    album: album,

                    artwork: artwork,

                    /*
                     * The front end uses this
                     * to begin the lyrics at
                     * the actual Shazam position.
                     */

                    matchPosition:
                        matchPosition,

                    timecode:
                        matchPosition
                },

                lyrics: lyrics

            });


        } catch (error) {

            console.error(
                "❌ Server error:",
                error
            );

            return res.status(500).json({

                error:
                    "Server error: " +
                    error.message

            });

        } finally {

            /*
             * Delete temporary files.
             */

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

            } catch (cleanupError) {

                console.error(
                    "Cleanup error:",
                    cleanupError.message
                );

            }

        }
    }
);


/* =========================================
   HEALTH CHECK
   ========================================= */

app.get(
    "/health",
    (req, res) => {

        res.json({

            status: "ok",

            songrec:
                fs.existsSync(
                    path.join(
                        __dirname,
                        "SongRec",
                        "target",
                        "release",
                        "songrec"
                    )
                ),

            ffmpeg: true,

            libraries:
                fs.existsSync(
                    path.join(
                        libsDir,
                        "libpipewire-0.3.so.0"
                    )
                ) &&
                fs.existsSync(
                    path.join(
                        libsDir,
                        "libasound.so.2"
                    )
                )

        });

    }
);


/* =========================================
   START SERVER
   ========================================= */

app.listen(
    PORT,
    () => {

        console.log(
            `🎵 Music Lyrics server running on port ${PORT}`
        );

    }
);