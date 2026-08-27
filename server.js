require("dotenv").config();

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const app = express();

const PORT =
    process.env.PORT || 3000;

const uploadDir =
    path.join(__dirname, "uploads");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, {
        recursive: true
    });
}

app.use(
    express.static(__dirname)
);

const upload =
    multer({
        dest: uploadDir
    });


/* =====================================================
   FFMPEG
===================================================== */

function convertToWav(
    inputFile,
    outputFile
) {

    return new Promise(
        (resolve, reject) => {

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
                    maxBuffer:
                        10 *
                        1024 *
                        1024
                },
                (
                    error,
                    stdout,
                    stderr
                ) => {

                    if (error) {

                        console.error(
                            "FFmpeg error:",
                            stderr
                        );

                        reject(
                            new Error(
                                "Audio conversion failed: " +
                                (
                                    stderr ||
                                    error.message
                                )
                            )
                        );

                        return;
                    }

                    resolve();
                }
            );
        }
    );
}


/* =====================================================
   SONGREC / SHAZAM
===================================================== */

function runSongRec(
    wavFile
) {

    return new Promise(
        (resolve, reject) => {

            const songrec =
                path.join(
                    __dirname,
                    "SongRec",
                    "target",
                    "release",
                    "songrec"
                );

            if (
                !fs.existsSync(
                    songrec
                )
            ) {

                reject(
                    new Error(
                        "SongRec executable not found at: " +
                        songrec
                    )
                );

                return;
            }

            console.log(
                "🎵 Running SongRec:",
                songrec
            );

            execFile(
                songrec,
                [
                    "recognize",
                    "-j",
                    wavFile
                ],
                {
                    timeout: 60000,
                    maxBuffer:
                        20 *
                        1024 *
                        1024
                },
                (
                    error,
                    stdout,
                    stderr
                ) => {

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

                    resolve(
                        stdout
                    );
                }
            );
        }
    );
}


/* =====================================================
   EXTRACT JSON
===================================================== */

function extractJson(
    text
) {

    if (!text) {
        return null;
    }

    text =
        text.trim();

    try {

        return JSON.parse(
            text
        );

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
   FIND TRACK
===================================================== */

function findTrack(
    data
) {

    if (!data) {
        return null;
    }

    if (
        data.track &&
        typeof data.track ===
            "object"
    ) {

        return data.track;
    }

    if (
        Array.isArray(
            data.matches
        ) &&
        data.matches.length > 0
    ) {

        return data.matches[0];
    }

    function search(
        object
    ) {

        if (
            !object ||
            typeof object !==
                "object"
        ) {

            return null;
        }

        if (
            typeof object.title ===
                "string" &&
            (
                typeof object.subtitle ===
                    "string" ||
                typeof object.artist ===
                    "string"
            )
        ) {

            return object;
        }

        for (
            const key of
                Object.keys(object)
        ) {

            const result =
                search(
                    object[key]
                );

            if (result) {
                return result;
            }
        }

        return null;
    }

    return search(data);
}


/* =====================================================
   FIND ALBUM
===================================================== */

function findAlbum(
    data
) {

    if (!data) {
        return "";
    }

    function search(
        object
    ) {

        if (
            !object ||
            typeof object !==
                "object"
        ) {

            return "";
        }

        if (
            Array.isArray(
                object.metadata
            )
        ) {

            for (
                const item of
                    object.metadata
            ) {

                if (
                    item &&
                    item.title ===
                        "Album" &&
                    typeof item.text ===
                        "string"
                ) {

                    return item.text;
                }
            }
        }

        for (
            const key of
                Object.keys(object)
        ) {

            const result =
                search(
                    object[key]
                );

            if (result) {
                return result;
            }
        }

        return "";
    }

    return search(data);
}


/* =====================================================
   FIND ARTWORK
===================================================== */

function findArtwork(
    data
) {

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

    function search(
        object
    ) {

        if (
            !object ||
            typeof object !==
                "object"
        ) {

            return "";
        }

        for (
            const key of
                possibleKeys
        ) {

            if (
                typeof object[key] ===
                    "string" &&
                object[key].startsWith(
                    "http"
                )
            ) {

                return object[key];
            }
        }

        for (
            const key of
                Object.keys(object)
        ) {

            const result =
                search(
                    object[key]
                );

            if (result) {
                return result;
            }
        }

        return "";
    }

    return search(data);
}


/* =====================================================
   FIND SHAZAM MATCH POSITION
===================================================== */

function findMatchPosition(
    data
) {

    if (!data) {
        return 0;
    }

    const possibleKeys = [
        "offset",
        "matchOffset",
        "matchPosition",
        "position"
    ];

    function search(
        object
    ) {

        if (
            !object ||
            typeof object !==
                "object"
        ) {

            return null;
        }

        for (
            const key of
                possibleKeys
        ) {

            if (
                typeof object[key] ===
                    "number"
            ) {

                return object[key];
            }
        }

        for (
            const key of
                Object.keys(object)
        ) {

            const result =
                search(
                    object[key]
                );

            if (
                typeof result ===
                    "number"
            ) {

                return result;
            }
        }

        return null;
    }

    return (
        search(data) || 0
    );
}


/* =====================================================
   FIND SONG DURATION
===================================================== */

function findDuration(
    data
) {

    if (!data) {
        return 0;
    }

    const possibleKeys = [
        "duration",
        "trackTime",
        "length"
    ];

    function search(
        object
    ) {

        if (
            !object ||
            typeof object !==
                "object"
        ) {

            return null;
        }

        for (
            const key of
                possibleKeys
        ) {

            const value =
                object[key];

            if (
                typeof value ===
                    "number" &&
                value > 0
            ) {

                /*
                 * Some APIs use milliseconds.
                 */

                if (
                    value > 10000
                ) {

                    return value / 1000;
                }

                return value;
            }
        }

        for (
            const key of
                Object.keys(object)
        ) {

            const result =
                search(
                    object[key]
                );

            if (
                typeof result ===
                    "number"
            ) {

                return result;
            }
        }

        return null;
    }

    return (
        search(data) || 0
    );
}


/* =====================================================
   LRCLIB
===================================================== */

async function getLrcLibLyrics(
    title,
    artist,
    album,
    duration
) {

    console.log(
        "📖 Searching LRCLIB..."
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

    console.log(
        "Duration:",
        duration
    );

    /*
     * FIRST:
     * Try the exact LRCLIB lookup.
     *
     * LRCLIB supports track_name,
     * artist_name, album_name and
     * duration.
     */

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

        if (
            duration &&
            duration > 0
        ) {

            params.set(
                "duration",
                Math.round(
                    duration
                )
            );
        }

        const url =
            "https://lrclib.net/api/get?" +
            params.toString();

        console.log(
            "LRCLIB exact request:",
            url
        );

        const response =
            await fetch(
                url,
                {
                    headers: {
                        "User-Agent":
                            "Music-Lyrics-App/1.0 (music lyrics app)"
                    }
                }
            );

        if (
            response.ok
        ) {

            const result =
                await response.json();

            console.log(
                "LRCLIB exact result received."
            );

            if (
                result &&
                result.syncedLyrics
            ) {

                console.log(
                    "✅ LRCLIB synchronized lyrics found!"
                );

                return {
                    syncedLyrics:
                        result.syncedLyrics,

                    plainLyrics:
                        result.plainLyrics ||
                        null,

                    source:
                        "LRCLIB"
                };
            }

            if (
                result &&
                result.plainLyrics
            ) {

                console.log(
                    "⚠️ LRCLIB found plain lyrics only."
                );

                return {
                    syncedLyrics:
                        null,

                    plainLyrics:
                        result.plainLyrics,

                    source:
                        "LRCLIB"
                };
            }
        }

    } catch (error) {

        console.error(
            "LRCLIB exact lookup error:",
            error.message
        );
    }


    /*
     * SECOND:
     * Search LRCLIB without duration.
     *
     * This helps when SongRec's
     * duration information isn't
     * available.
     */

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
            "https://lrclib.net/api/search?" +
            params.toString();

        console.log(
            "LRCLIB search request:",
            url
        );

        const response =
            await fetch(
                url,
                {
                    headers: {
                        "User-Agent":
                            "Music-Lyrics-App/1.0 (music lyrics app)"
                    }
                }
            );

        if (!response.ok) {

            console.log(
                "LRCLIB search HTTP:",
                response.status
            );

            return null;
        }

        const results =
            await response.json();

        if (
            !Array.isArray(results) ||
            results.length === 0
        ) {

            console.log(
                "❌ No LRCLIB results."
            );

            return null;
        }


        /*
         * Prefer results that have
         * synchronized lyrics.
         */

        const syncedResults =
            results.filter(
                result =>
                    result &&
                    typeof result.syncedLyrics ===
                        "string" &&
                    result.syncedLyrics.length >
                        0
            );


        /*
         * If possible, choose the result
         * closest to the recognized duration.
         */

        let candidates =
            syncedResults.length
                ? syncedResults
                : results;


        if (
            duration &&
            duration > 0
        ) {

            candidates =
                [...candidates].sort(
                    (a, b) => {

                        const aDuration =
                            Number(
                                a.duration
                            ) || 0;

                        const bDuration =
                            Number(
                                b.duration
                            ) || 0;

                        return (
                            Math.abs(
                                aDuration -
                                duration
                            ) -
                            Math.abs(
                                bDuration -
                                duration
                            )
                        );
                    }
                );
        }


        const best =
            candidates[0];


        if (!best) {
            return null;
        }


        if (
            best.syncedLyrics
        ) {

            console.log(
                "✅ LRCLIB search found synchronized lyrics!"
            );

            return {

                syncedLyrics:
                    best.syncedLyrics,

                plainLyrics:
                    best.plainLyrics ||
                    null,

                source:
                    "LRCLIB"
            };
        }


        if (
            best.plainLyrics
        ) {

            console.log(
                "⚠️ LRCLIB search found plain lyrics only."
            );

            return {

                syncedLyrics:
                    null,

                plainLyrics:
                    best.plainLyrics,

                source:
                    "LRCLIB"
            };
        }

    } catch (error) {

        console.error(
            "LRCLIB search error:",
            error.message
        );
    }

    return null;
}


/* =====================================================
   IDENTIFY SONG
===================================================== */

app.post(
    "/identify-shazam",
    upload.single("audio"),
    async (
        req,
        res
    ) => {

        let inputFile =
            null;

        let wavFile =
            null;

        try {

            if (!req.file) {

                return res
                    .status(400)
                    .json({
                        error:
                            "No audio file received."
                    });
            }


            /* -----------------------------------------
               INPUT
            ----------------------------------------- */

            inputFile =
                req.file.path;

            wavFile =
                path.join(
                    uploadDir,
                    req.file.filename +
                    ".wav"
                );

            console.log(
                "🎤 Audio received:"
            );

            console.log(
                inputFile
            );


            /* -----------------------------------------
               CONVERT
            ----------------------------------------- */

            console.log(
                "🔄 Converting audio..."
            );

            await convertToWav(
                inputFile,
                wavFile
            );

            console.log(
                "✅ WAV ready."
            );


            /* -----------------------------------------
               SONGREC
            ----------------------------------------- */

            console.log(
                "🔎 Identifying song..."
            );

            const stdout =
                await runSongRec(
                    wavFile
                );


            const shazamData =
                extractJson(
                    stdout
                );


            if (!shazamData) {

                return res
                    .status(500)
                    .json({
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

                return res
                    .status(404)
                    .json({
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


            const duration =
                findDuration(
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
                "⏱️ DURATION:",
                duration
            );

            console.log(
                "🎯 SHAZAM POSITION:",
                matchPosition
            );

            console.log(
                "================================"
            );


            /* -----------------------------------------
               LYRICS
            ----------------------------------------- */

            const lyrics =
                await getLrcLibLyrics(
                    title,
                    artist,
                    album,
                    duration
                );


            if (
                lyrics &&
                lyrics.syncedLyrics
            ) {

                console.log(
                    "🎉 SYNCHRONIZED LYRICS READY!"
                );

            } else if (
                lyrics &&
                lyrics.plainLyrics
            ) {

                console.log(
                    "⚠️ Plain lyrics only."
                );

            } else {

                console.log(
                    "❌ No lyrics found."
                );
            }


            /* -----------------------------------------
               RESPONSE
            ----------------------------------------- */

            return res.json({

                success:
                    true,

                song: {

                    title:
                        title,

                    artist:
                        artist,

                    album:
                        album,

                    artwork:
                        artwork,

                    /*
                     * Send ALL of these names
                     * so your current frontend
                     * remains compatible.
                     */

                    matchPosition:
                        matchPosition,

                    matchOffset:
                        matchPosition,

                    timecode:
                        matchPosition,

                    duration:
                        duration
                },

                lyrics:
                    lyrics
            });

        } catch (error) {

            console.error(
                "❌ SERVER ERROR:",
                error
            );

            return res
                .status(500)
                .json({
                    error:
                        "Server error: " +
                        error.message
                });

        } finally {

            /* -----------------------------------------
               CLEANUP
            ----------------------------------------- */

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

            } catch (
                cleanupError
            ) {

                console.error(
                    "Cleanup error:",
                    cleanupError.message
                );
            }
        }
    }
);


/* =====================================================
   HEALTH CHECK
===================================================== */

app.get(
    "/health",
    (
        req,
        res
    ) => {

        const songrec =
            path.join(
                __dirname,
                "SongRec",
                "target",
                "release",
                "songrec"
            );

        res.json({

            status:
                "ok",

            songrec:
                fs.existsSync(
                    songrec
                ),

            ffmpeg:
                true,

            lyrics:
                "LRCLIB"
        });
    }
);


/* =====================================================
   START SERVER
===================================================== */

app.listen(
    PORT,
    () => {

        console.log(
            `🎵 Music Lyrics server running on port ${PORT}`
        );
    }
);