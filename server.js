require("dotenv").config();

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const app = express();

const upload = multer({
    dest: "uploads/"
});

app.use(express.static(__dirname));


/* =========================
   IDENTIFY SONG WITH SHAZAM
========================= */

app.post(
    "/identify-shazam",
    upload.single("audio"),
    async (req, res) => {

        let inputFile = null;
        let wavFile = null;

        try {

            if (!req.file) {
                return res.status(400).json({
                    error: "No audio file received."
                });
            }

            inputFile = req.file.path;

            console.log("🎧 Received audio:", inputFile);


            /* =========================
               CONVERT AUDIO TO WAV
            ========================= */

            wavFile = path.join(
                "uploads",
                req.file.filename + ".wav"
            );

            await convertToWav(
                inputFile,
                wavFile
            );

            console.log(
                "🎵 WAV ready:",
                wavFile
            );


            /* =========================
               SONGREC
            ========================= */

            const songrec = path.join(
                __dirname,
                "SongRec",
                "target",
                "release",
                "songrec"
            );

            if (!fs.existsSync(songrec)) {
                throw new Error(
                    "SongRec executable not found at: " +
                    songrec
                );
            }

            console.log(
                "🔎 Running SongRec..."
            );


            execFile(
                songrec,
                [
                    "recognize",
                    "-j",
                    wavFile
                ],
                {
                    maxBuffer: 20 * 1024 * 1024,
                    timeout: 60000
                },

                async (
                    error,
                    stdout,
                    stderr
                ) => {

                    try {

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
                                error.message
                            );

                            return res.status(500).json({
                                error:
                                    "Shazam recognition failed.",
                                details:
                                    stderr ||
                                    error.message
                            });
                        }


                        const output =
                            stdout.trim();


                        if (!output) {

                            return res.status(404).json({
                                error:
                                    "Song not identified."
                            });
                        }


                        /* =========================
                           PARSE SHAZAM JSON
                        ========================= */

                        let shazamData;

                        try {

                            shazamData =
                                JSON.parse(output);

                        } catch (jsonError) {

                            console.error(
                                "❌ JSON parse error:",
                                jsonError.message
                            );

                            return res.status(500).json({
                                error:
                                    "Could not read Shazam result.",
                                details:
                                    jsonError.message
                            });
                        }


                        /* =========================
                           SONG DATA
                        ========================= */

                        const track =
                            shazamData.track ||
                            shazamData;


                        const title =
                            track.title ||
                            "Unknown Song";


                        const artist =
                            track.subtitle ||
                            track.artist ||
                            "Unknown Artist";


                        console.log(
                            "🎵 Song:",
                            title
                        );

                        console.log(
                            "👤 Artist:",
                            artist
                        );


                        /* =========================
                           FIND SHAZAM OFFSET
                        ========================= */

                        let matchOffset = 0;


                        /*
                         * Shazam/SongRec puts
                         * fingerprint matches in
                         * track.matches.
                         */

                        const matches =
                            Array.isArray(
                                track.matches
                            )
                                ? track.matches
                                : Array.isArray(
                                    shazamData.matches
                                )
                                    ? shazamData.matches
                                    : [];


                        const offsets =
                            matches
                                .map(
                                    match =>
                                        Number(
                                            match.offset
                                        )
                                )
                                .filter(
                                    Number.isFinite
                                );


                        if (
                            offsets.length > 0
                        ) {

                            /*
                             * Use the median offset.
                             *
                             * This is more reliable than
                             * blindly using the first match.
                             */

                            const sortedOffsets =
                                [...offsets].sort(
                                    (a, b) =>
                                        a - b
                                );


                            const middle =
                                Math.floor(
                                    sortedOffsets.length / 2
                                );


                            if (
                                sortedOffsets.length % 2
                            ) {

                                matchOffset =
                                    sortedOffsets[
                                        middle
                                    ];

                            } else {

                                matchOffset =
                                    (
                                        sortedOffsets[
                                            middle - 1
                                        ] +
                                        sortedOffsets[
                                            middle
                                        ]
                                    ) / 2;

                            }

                        }


                        /*
                         * Also check track.timecode
                         * if it exists.
                         */

                        if (
                            matchOffset === 0 &&
                            track.timecode
                        ) {

                            const parts =
                                String(
                                    track.timecode
                                ).split(":");


                            if (
                                parts.length === 2
                            ) {

                                matchOffset =
                                    (
                                        Number(
                                            parts[0]
                                        ) * 60
                                    ) +
                                    Number(
                                        parts[1]
                                    );

                            }

                        }


                        console.log(
                            "⏱️ Shazam match position:",
                            matchOffset,
                            "seconds"
                        );


                        /* =========================
                           ARTWORK
                        ========================= */

                        let artwork = null;


                        if (
                            track.images &&
                            track.images.coverart
                        ) {

                            artwork =
                                track.images.coverart;

                        }


                        if (
                            !artwork &&
                            track.share &&
                            track.share.image
                        ) {

                            artwork =
                                track.share.image;

                        }


                        /* =========================
                           LYRICS
                        ========================= */

                        let lyrics = null;


                        try {

                            const lyricsURL =
                                "https://lrclib.net/api/get?" +
                                "track_name=" +
                                encodeURIComponent(
                                    title
                                ) +
                                "&artist_name=" +
                                encodeURIComponent(
                                    artist
                                );


                            console.log(
                                "📖 Looking for lyrics..."
                            );


                            const lyricsResponse =
                                await fetch(
                                    lyricsURL
                                );


                            if (
                                lyricsResponse.ok
                            ) {

                                lyrics =
                                    await lyricsResponse.json();

                                console.log(
                                    "✅ Lyrics found."
                                );

                            } else {

                                console.log(
                                    "⚠️ Lyrics not found."
                                );

                            }

                        } catch (
                            lyricsError
                        ) {

                            console.error(
                                "Lyrics error:",
                                lyricsError.message
                            );

                        }


                        /* =========================
                           SEND RESULT TO WEBSITE
                        ========================= */

                        return res.json({

                            song: {

                                title:
                                    title,

                                artist:
                                    artist,

                                artwork:
                                    artwork,

                                timecode:
                                    matchOffset,

                                matchOffset:
                                    matchOffset

                            },

                            lyrics:
                                lyrics

                        });

                    }

                    catch (innerError) {

                        console.error(
                            "❌ Processing error:",
                            innerError
                        );

                        return res.status(500).json({
                            error:
                                "Could not process Shazam result.",
                            details:
                                innerError.message
                        });

                    }

                    finally {

                        cleanup(
                            inputFile
                        );

                        cleanup(
                            wavFile
                        );

                    }

                }
            );

        }

        catch (error) {

            console.error(
                "❌ Server error:",
                error
            );

            cleanup(
                inputFile
            );

            cleanup(
                wavFile
            );

            return res.status(500).json({

                error:
                    "Server error: " +
                    error.message

            });

        }

    }
);


/* =========================
   CONVERT AUDIO TO WAV
========================= */

function convertToWav(
    input,
    output
) {

    return new Promise(
        (
            resolve,
            reject
        ) => {

            execFile(
                "ffmpeg",

                [
                    "-y",

                    "-i",
                    input,

                    "-ac",
                    "1",

                    "-ar",
                    "44100",

                    "-sample_fmt",
                    "s16",

                    output
                ],

                {
                    timeout: 60000
                },

                (
                    error,
                    stdout,
                    stderr
                ) => {

                    if (error) {

                        console.error(
                            "❌ FFmpeg error:",
                            stderr
                        );

                        reject(
                            new Error(
                                "FFmpeg could not convert audio."
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


/* =========================
   DELETE TEMPORARY FILE
========================= */

function cleanup(
    file
) {

    if (
        file &&
        fs.existsSync(file)
    ) {

        try {

            fs.unlinkSync(
                file
            );

        }

        catch (error) {

            console.error(
                "Cleanup error:",
                error.message
            );

        }

    }

}


/* =========================
   START SERVER
========================= */

const PORT =
    process.env.PORT || 3000;


app.listen(
    PORT,
    () => {

        console.log(
            `🎵 Music Lyrics server running on port ${PORT}`
        );

    }
);