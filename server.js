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
   RUN SONGREC
========================================================= */

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

        console.log("Running SongRec:", songrec);

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

                console.log(
                    "SongRec stderr:",
                    stderr
                );

                if (error) {

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
    }
    catch (error) {
        // Continue
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
        }
        catch (error) {
            console.error(
                "Could not parse JSON:",
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

    function search(object) {

        if (
            !object ||
            typeof object !== "object"
        ) {
            return "";
        }

        const possibleKeys = [
            "coverart",
            "coverArt",
            "artwork",
            "image",
            "avatar"
        ];

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
   FIND SONG MATCH POSITION
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
                typeof object[key] === "number" &&
                object[key] >= 0
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
   LRCLIB
========================================================= */

async function getLyrics(
    title,
    artist,
    album = ""
) {

    console.log(
        "🎵 Searching LRCLIB..."
    );

    console.log(
        "Title:",
        title
    );

    console.log(
        "Artist:",
        artist
    );

    console.log(
        "Album:",
        album
    );

    try {

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

        console.log(
            "LRCLIB request:",
            url
        );

        const response =
            await fetch(
                url,
                {
                    headers: {
                        "User-Agent":
                            "Music-Lyrics-App/1.0"
                    }
                }
            );

        if (
            response.status === 404
        ) {

            console.log(
                "❌ LRCLIB: song not found"
            );

            return null;
        }

        if (
            response.status === 429
        ) {

            console.log(
                "⚠️ LRCLIB rate limited"
            );

            return null;
        }

        if (!response.ok) {

            console.log(
                "LRCLIB HTTP error:",
                response.status
            );

            return null;
        }

        const data =
            await response.json();

        console.log(
            "LRCLIB result:",
            JSON.stringify(
                data,
                null,
                2
            )
        );

        /*
         * THIS IS THE IMPORTANT PART.
         *
         * syncedLyrics must exist AND contain
         * actual timestamps.
         */

        if (
            data &&
            typeof data.syncedLyrics === "string" &&
            data.syncedLyrics.trim().length > 0
        ) {

            const synced =
                normalizeSyncedLyrics(
                    data.syncedLyrics
                );

            if (synced) {

                console.log(
                    "✅ REAL SYNCHRONIZED LYRICS FOUND"
                );

                return {
                    syncedLyrics: synced,
                    plainLyrics:
                        data.plainLyrics || null,
                    source: "LRCLIB"
                };
            }
        }

        /*
         * Plain lyrics are NOT returned as synced lyrics.
         */

        if (
            data &&
            typeof data.plainLyrics === "string" &&
            data.plainLyrics.trim().length > 0
        ) {

            console.log(
                "⚠️ LRCLIB only returned plain lyrics."
            );

            return {
                syncedLyrics: null,
                plainLyrics:
                    data.plainLyrics,
                source: "LRCLIB"
            };
        }

        return null;

    }
    catch (error) {

        console.error(
            "LRCLIB error:",
            error.message
        );

        return null;
    }
}

/* =========================================================
   NORMALIZE LRC
========================================================= */

function normalizeSyncedLyrics(text) {

    if (
        !text ||
        typeof text !== "string"
    ) {
        return null;
    }

    const lines =
        text.split(/\r?\n/);

    const output = [];

    for (
        const line of lines
    ) {

        /*
         * Accept:
         *
         * [00:12.34] Lyrics
         *
         * [01:02.50] Lyrics
         */

        const match =
            line.match(
                /^\s*\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)$/
            );

        if (!match) {
            continue;
        }

        const minutes =
            parseInt(
                match[1],
                10
            );

        const seconds =
            parseInt(
                match[2],
                10
            );

        let fraction =
            match[3] || "0";

        let milliseconds = 0;

        if (fraction.length === 1) {

            milliseconds =
                parseInt(
                    fraction,
                    10
                ) * 100;

        }
        else if (
            fraction.length === 2
        ) {

            milliseconds =
                parseInt(
                    fraction,
                    10
                ) * 10;

        }
        else {

            milliseconds =
                parseInt(
                    fraction.substring(
                        0,
                        3
                    ),
                    10
                );
        }

        const totalSeconds =
            minutes * 60 +
            seconds +
            milliseconds / 1000;

        const lyricText =
            match[4].trim();

        output.push({
            time:
                totalSeconds,
            text:
                lyricText
        });
    }

    if (
        output.length === 0
    ) {
        return null;
    }

    output.sort(
        (a, b) =>
            a.time - b.time
    );

    /*
     * Convert back to standard LRC.
     */

    return output
        .map(line => {

            const minutes =
                Math.floor(
                    line.time / 60
                );

            const seconds =
                line.time -
                minutes * 60;

            return (
                "[" +
                String(minutes)
                    .padStart(2, "0") +
                ":" +
                seconds
                    .toFixed(2)
                    .padStart(5, "0") +
                "] " +
                line.text
            );
        })
        .join("\n");
}

/* =========================================================
   IDENTIFY SONG
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

            /* -----------------------------------------
               WAV
            ----------------------------------------- */

            wavFile =
                path.join(
                    uploadDir,
                    req.file.filename +
                    ".wav"
                );

            console.log(
                "🔄 Converting audio..."
            );

            await convertToWav(
                inputFile,
                wavFile
            );

            console.log(
                "✅ WAV ready"
            );

            /* -----------------------------------------
               SONGREC
            ----------------------------------------- */

            console.log(
                "🔎 Sending audio to SongRec..."
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

            /* -----------------------------------------
               TRACK
            ----------------------------------------- */

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
                "================================"
            );

            console.log(
                "🎵 SONG:",
                title
            );

            console.log(
                "👤 ARTIST:",
                artist
            );

            console.log(
                "💿 ALBUM:",
                album || "Unknown"
            );

            console.log(
                "🎯 MATCH POSITION:",
                matchPosition
            );

            console.log(
                "================================"
            );

            /* -----------------------------------------
               LYRICS
            ----------------------------------------- */

            const lyrics =
                await getLyrics(
                    title,
                    artist,
                    album
                );

            /* -----------------------------------------
               RESPONSE
            ----------------------------------------- */

            if (
                lyrics &&
                lyrics.syncedLyrics
            ) {

                console.log(
                    "✅ Sending synchronized lyrics."
                );

                return res.json({

                    success: true,

                    song: {

                        title,
                        artist,
                        album,
                        artwork,

                        /*
                         * This is the position in the
                         * recording where SongRec
                         * recognized the song.
                         */

                        matchPosition,
                        timecode:
                            matchPosition
                    },

                    lyrics: {

                        syncedLyrics:
                            lyrics.syncedLyrics,

                        plainLyrics:
                            lyrics.plainLyrics,

                        synchronized:
                            true,

                        source:
                            lyrics.source
                    }
                });
            }

            /*
             * Plain lyrics only.
             */

            if (
                lyrics &&
                lyrics.plainLyrics
            ) {

                console.log(
                    "⚠️ Plain lyrics found, but NO timestamps."
                );

                return res.json({

                    success: true,

                    song: {

                        title,
                        artist,
                        album,
                        artwork,
                        matchPosition,
                        timecode:
                            matchPosition
                    },

                    lyrics: {

                        syncedLyrics:
                            null,

                        plainLyrics:
                            lyrics.plainLyrics,

                        synchronized:
                            false,

                        source:
                            lyrics.source
                    }
                });
            }

            console.log(
                "⚠️ No lyrics found."
            );

            return res.json({

                success: true,

                song: {

                    title,
                    artist,
                    album,
                    artwork,
                    matchPosition,
                    timecode:
                        matchPosition
                },

                lyrics: null
            });

        }
        catch (error) {

            console.error(
                "❌ SERVER ERROR:",
                error
            );

            return res.status(500).json({

                error:
                    "Server error: " +
                    error.message
            });

        }
        finally {

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

            }
            catch (cleanupError) {

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
                    songrecPath
                ),

            songrecPath,

            ffmpeg:
                true,

            lyricsProvider:
                "LRCLIB"
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
            "🎤 Song recognition: SongRec"
        );

        console.log(
            "📖 Lyrics: LRCLIB"
        );

        console.log(
            "⏱️ Synchronized lyrics: enabled"
        );
    }
);