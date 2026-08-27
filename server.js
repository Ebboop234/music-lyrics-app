require("dotenv").config();

const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { execFile, execFileSync } = require("child_process");

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
   BASIC HELPERS
========================================================= */

function cleanText(value) {
    if (!value) return "";

    return String(value)
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeText(value) {
    return cleanText(value)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\w\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function removeFeaturing(value) {
    return normalizeText(value)
        .replace(
            /\b(feat|ft|featuring)\b.*$/i,
            ""
        )
        .trim();
}

/* =========================================================
   AUDIO DURATION
========================================================= */

function getAudioDuration(file) {
    return new Promise((resolve) => {
        execFile(
            "ffprobe",
            [
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                file
            ],
            {
                timeout: 15000
            },
            (error, stdout) => {
                if (error) {
                    console.log(
                        "⚠️ Could not determine audio duration."
                    );

                    resolve(null);
                    return;
                }

                const duration =
                    parseFloat(
                        String(stdout).trim()
                    );

                if (
                    Number.isFinite(duration) &&
                    duration > 0
                ) {
                    console.log(
                        "⏱️ Audio duration:",
                        duration,
                        "seconds"
                    );

                    resolve(duration);
                } else {
                    resolve(null);
                }
            }
        );
    });
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
   SONGREC PATH
========================================================= */

function getSongRecPath() {
    if (
        process.env.SONGREC_PATH &&
        fs.existsSync(
            process.env.SONGREC_PATH
        )
    ) {
        return process.env.SONGREC_PATH;
    }

    const paths = [
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

    for (const file of paths) {
        if (fs.existsSync(file)) {
            return file;
        }
    }

    return null;
}

/* =========================================================
   RUN SONGREC / SHAZAM
========================================================= */

function runSongRec(wavFile) {
    return new Promise((resolve, reject) => {
        const songrec =
            getSongRecPath();

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

        execFile(
            songrec,
            [
                "recognize",
                "-j",
                wavFile
            ],
            {
                env: {
                    ...process.env
                },

                timeout: 60000,

                maxBuffer:
                    20 * 1024 * 1024
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

    text =
        String(text).trim();

    try {
        return JSON.parse(text);
    } catch (_) {}

    const first =
        text.indexOf("{");

    const last =
        text.lastIndexOf("}");

    if (
        first !== -1 &&
        last !== -1 &&
        last > first
    ) {
        try {
            return JSON.parse(
                text.substring(
                    first,
                    last + 1
                )
            );
        } catch (_) {}
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

/* =========================================================
   FIND MATCH POSITION
========================================================= */

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

        for (const key of keys) {
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
    const keys = [
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

        for (const key of keys) {
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
   LRCLIB USER AGENT
========================================================= */

const LRCLIB_HEADERS = {
    "User-Agent":
        "Music-Lyrics-App/1.0 (https://github.com/Ebboop234/music-lyrics-app)"
};

/* =========================================================
   LRCLIB EXACT GET
========================================================= */

async function lrclibGet(
    title,
    artist,
    album,
    duration
) {
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
            Number.isFinite(duration)
        ) {
            params.set(
                "duration",
                String(
                    Math.round(duration)
                )
            );
        }

        const url =
            "https://lrclib.net/api/get?" +
            params.toString();

        console.log(
            "🔎 LRCLIB exact lookup:",
            url
        );

        const response =
            await fetch(
                url,
                {
                    headers:
                        LRCLIB_HEADERS
                }
            );

        if (!response.ok) {
            console.log(
                "LRCLIB /get:",
                response.status
            );

            return null;
        }

        return await response.json();

    } catch (error) {
        console.error(
            "LRCLIB /get error:",
            error.message
        );

        return null;
    }
}

/* =========================================================
   LRCLIB SEARCH
========================================================= */

async function lrclibSearch(
    title,
    artist,
    album
) {
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
            "🔎 LRCLIB search:",
            url
        );

        const response =
            await fetch(
                url,
                {
                    headers:
                        LRCLIB_HEADERS
                }
            );

        if (!response.ok) {
            console.log(
                "LRCLIB /search:",
                response.status
            );

            return [];
        }

        const data =
            await response.json();

        return Array.isArray(data)
            ? data
            : [];

    } catch (error) {
        console.error(
            "LRCLIB search error:",
            error.message
        );

        return [];
    }
}

/* =========================================================
   SCORE LRCLIB RESULT
========================================================= */

function scoreLyricsResult(
    result,
    title,
    artist,
    album
) {
    const wantedTitle =
        normalizeText(title);

    const wantedArtist =
        removeFeaturing(artist);

    const wantedAlbum =
        normalizeText(album);

    const resultTitle =
        normalizeText(
            result.trackName ||
            result.name ||
            ""
        );

    const resultArtist =
        removeFeaturing(
            result.artistName ||
            ""
        );

    const resultAlbum =
        normalizeText(
            result.albumName ||
            ""
        );

    let score = 0;

    /*
     * Title
     */

    if (
        resultTitle === wantedTitle
    ) {
        score += 60;
    } else if (
        resultTitle.includes(
            wantedTitle
        ) ||
        wantedTitle.includes(
            resultTitle
        )
    ) {
        score += 35;
    }

    /*
     * Artist
     */

    if (
        resultArtist === wantedArtist
    ) {
        score += 50;
    } else if (
        resultArtist.includes(
            wantedArtist
        ) ||
        wantedArtist.includes(
            resultArtist
        )
    ) {
        score += 25;
    }

    /*
     * Album
     */

    if (
        wantedAlbum &&
        resultAlbum === wantedAlbum
    ) {
        score += 20;
    }

    /*
     * Prefer synchronized lyrics.
     */

    if (
        result.syncedLyrics
    ) {
        score += 30;
    }

    /*
     * Prefer actual lyrics.
     */

    if (
        result.plainLyrics
    ) {
        score += 10;
    }

    return score;
}

/* =========================================================
   CHOOSE BEST LRCLIB RESULT
========================================================= */

function chooseBestLyricsResult(
    results,
    title,
    artist,
    album
) {
    if (
        !Array.isArray(results) ||
        results.length === 0
    ) {
        return null;
    }

    const scored =
        results
            .map(result => ({
                result,
                score:
                    scoreLyricsResult(
                        result,
                        title,
                        artist,
                        album
                    )
            }))
            .sort(
                (a, b) =>
                    b.score -
                    a.score
            );

    console.log(
        "📊 LRCLIB candidates:"
    );

    for (
        const item of scored.slice(0, 5)
    ) {
        console.log(
            `   ${item.score} — ${item.result.trackName} — ${item.result.artistName}`
        );
    }

    /*
     * Don't accept a completely unrelated song.
     */

    if (
        scored[0].score < 60
    ) {
        console.log(
            "⚠️ Best LRCLIB result was not a strong enough match."
        );

        return null;
    }

    return scored[0].result;
}

/* =========================================================
   CLEAN SYNCED LYRICS
========================================================= */

function cleanSyncedLyrics(text) {
    if (
        !text ||
        typeof text !== "string"
    ) {
        return null;
    }

    const output = [];

    for (
        const rawLine of
        text.split(/\r?\n/)
    ) {
        const line =
            rawLine.trim();

        const match =
            line.match(
                /^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/
            );

        if (!match) {
            continue;
        }

        const lyric =
            cleanText(
                match[3]
            );

        if (!lyric) {
            continue;
        }

        output.push(
            line
        );
    }

    if (
        output.length === 0
    ) {
        return null;
    }

    return output.join("\n");
}

/* =========================================================
   ESTIMATE TIMING FOR PLAIN LYRICS
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
            .map(cleanText)
            .filter(Boolean);

    if (
        lines.length === 0
    ) {
        return null;
    }

    /*
     * Start near the Shazam recognition
     * position, but back up slightly.
     */

    let currentTime =
        Math.max(
            0,
            Number(matchPosition || 0) - 5
        );

    const output = [];

    for (
        const line of lines
    ) {
        const minutes =
            Math.floor(
                currentTime / 60
            );

        const seconds =
            currentTime -
            minutes * 60;

        const timestamp =
            `[${String(minutes).padStart(2, "0")}:${seconds.toFixed(2).padStart(5, "0")}]`;

        output.push(
            timestamp +
            line
        );

        const words =
            line.split(/\s+/)
                .length;

        let advance =
            3.2;

        if (words > 10) {
            advance += 0.7;
        }

        if (words > 18) {
            advance += 0.8;
        }

        currentTime +=
            advance;
    }

    return output.join("\n");
}

/* =========================================================
   GET LYRICS FROM LRCLIB
========================================================= */

async function getLyricsFromLrclib(
    title,
    artist,
    album,
    duration,
    matchPosition
) {
    /*
     * FIRST:
     * exact /api/get using duration
     */

    if (
        Number.isFinite(duration)
    ) {
        const exact =
            await lrclibGet(
                title,
                artist,
                album,
                duration
            );

        if (exact) {
            if (
                exact.syncedLyrics
            ) {
                const synced =
                    cleanSyncedLyrics(
                        exact.syncedLyrics
                    );

                if (synced) {
                    console.log(
                        "✅ LRCLIB exact synchronized lyrics found."
                    );

                    return {
                        syncedLyrics:
                            synced,

                        estimated:
                            false,

                        source:
                            "lrclib-exact"
                    };
                }
            }

            if (
                exact.plainLyrics
            ) {
                const estimated =
                    createEstimatedSyncedLyrics(
                        exact.plainLyrics,
                        matchPosition
                    );

                if (estimated) {
                    console.log(
                        "✅ LRCLIB exact plain lyrics found."
                    );

                    return {
                        syncedLyrics:
                            estimated,

                        estimated:
                            true,

                        source:
                            "lrclib-estimated"
                    };
                }
            }
        }
    }

    /*
     * SECOND:
     * broad search
     */

    let results =
        await lrclibSearch(
            title,
            artist,
            album
        );

    /*
     * If the structured search doesn't
     * return anything, try a simple query.
     */

    if (
        results.length === 0
    ) {
        try {
            const params =
                new URLSearchParams();

            params.set(
                "q",
                `${title} ${artist}`
            );

            const response =
                await fetch(
                    "https://lrclib.net/api/search?" +
                    params.toString(),
                    {
                        headers:
                            LRCLIB_HEADERS
                    }
                );

            if (response.ok) {
                const data =
                    await response.json();

                if (
                    Array.isArray(data)
                ) {
                    results = data;
                }
            }
        } catch (error) {
            console.error(
                "LRCLIB broad search error:",
                error.message
            );
        }
    }

    const best =
        chooseBestLyricsResult(
            results,
            title,
            artist,
            album
        );

    if (!best) {
        return null;
    }

    if (
        best.syncedLyrics
    ) {
        const synced =
            cleanSyncedLyrics(
                best.syncedLyrics
            );

        if (synced) {
            console.log(
                "✅ LRCLIB search synchronized lyrics found."
            );

            return {
                syncedLyrics:
                    synced,

                estimated:
                    false,

                source:
                    "lrclib-search"
            };
        }
    }

    if (
        best.plainLyrics
    ) {
        const estimated =
            createEstimatedSyncedLyrics(
                best.plainLyrics,
                matchPosition
            );

        if (estimated) {
            console.log(
                "✅ LRCLIB search plain lyrics found; estimated timing created."
            );

            return {
                syncedLyrics:
                    estimated,

                estimated:
                    true,

                source:
                    "lrclib-search-estimated"
            };
        }
    }

    return null;
}

/* =========================================================
   LYRICS.OVH FALLBACK
========================================================= */

async function getLyricsFromOvh(
    title,
    artist,
    matchPosition
) {
    try {
        const url =
            "https://api.lyrics.ovh/v1/" +
            encodeURIComponent(artist) +
            "/" +
            encodeURIComponent(title);

        console.log(
            "🔎 Trying lyrics.ovh..."
        );

        const response =
            await fetch(url);

        if (!response.ok) {
            return null;
        }

        const data =
            await response.json();

        if (
            data &&
            data.lyrics
        ) {
            const estimated =
                createEstimatedSyncedLyrics(
                    data.lyrics,
                    matchPosition
                );

            if (estimated) {
                console.log(
                    "✅ lyrics.ovh lyrics found."
                );

                return {
                    syncedLyrics:
                        estimated,

                    estimated:
                        true,

                    source:
                        "lyrics.ovh"
                };
            }
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
   AUDD FALLBACK
========================================================= */

async function getLyricsFromAudd(
    title,
    artist,
    matchPosition
) {
    const token =
        process.env.AUDD_TOKEN ||
        process.env.AUDD_API_TOKEN;

    if (!token) {
        return null;
    }

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

        if (!response.ok) {
            return null;
        }

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
                    "✅ AUDD lyrics found."
                );

                return {
                    syncedLyrics:
                        estimated,

                    estimated:
                        true,

                    source:
                        "audd"
                };
            }
        }

    } catch (error) {
        console.error(
            "AUDD error:",
            error.message
        );
    }

    return null;
}

/* =========================================================
   MASTER LYRICS FUNCTION
========================================================= */

async function getLyrics(
    title,
    artist,
    album,
    duration,
    matchPosition
) {
    console.log(
        "📖 Looking for lyrics:"
    );

    console.log(
        "   Title:",
        title
    );

    console.log(
        "   Artist:",
        artist
    );

    console.log(
        "   Album:",
        album || "Unknown"
    );

    console.log(
        "   Duration:",
        duration || "Unknown"
    );

    /*
     * LRCLIB
     */

    let result =
        await getLyricsFromLrclib(
            title,
            artist,
            album,
            duration,
            matchPosition
        );

    if (result) {
        return result;
    }

    /*
     * lyrics.ovh
     */

    result =
        await getLyricsFromOvh(
            title,
            artist,
            matchPosition
        );

    if (result) {
        return result;
    }

    /*
     * AUDD
     */

    result =
        await getLyricsFromAudd(
            title,
            artist,
            matchPosition
        );

    if (result) {
        return result;
    }

    console.log(
        "⚠️ No lyrics found from available sources."
    );

    return null;
}

/* =========================================================
   IDENTIFY SHAZAM
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
             * Get original recording duration
             */

            const recordingDuration =
                await getAudioDuration(
                    inputFile
                );

            /*
             * Convert
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
             * SongRec
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
             * Track
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
             * Shazam match position
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
                "🎯 Match position:",
                matchPosition
            );

            /*
             * IMPORTANT:
             *
             * SongRec's input recording is only
             * the 8-second microphone sample.
             *
             * Therefore recordingDuration is
             * NOT the full song duration.
             *
             * We first try to get a duration
             * from the Shazam JSON itself.
             */

            let songDuration =
                null;

            function findDuration(
                object
            ) {
                if (
                    !object ||
                    typeof object !== "object"
                ) {
                    return null;
                }

                const keys = [
                    "duration",
                    "durationInSeconds",
                    "songDuration",
                    "trackDuration"
                ];

                for (
                    const key of keys
                ) {
                    const value =
                        object[key];

                    if (
                        typeof value === "number" &&
                        value > 30 &&
                        value < 36000
                    ) {
                        return value;
                    }
                }

                for (
                    const key of Object.keys(object)
                ) {
                    const result =
                        findDuration(
                            object[key]
                        );

                    if (
                        result
                    ) {
                        return result;
                    }
                }

                return null;
            }

            songDuration =
                findDuration(
                    shazamData
                );

            console.log(
                "⏱️ Detected song duration:",
                songDuration ||
                "not available"
            );

            /*
             * Lyrics
             */

            const lyrics =
                await getLyrics(
                    title,
                    artist,
                    album,
                    songDuration,
                    matchPosition
                );

            /*
             * Return
             */

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
            } catch (error) {
                console.error(
                    "Cleanup error:",
                    error.message
                );
            }
        }
    }
);

/* =========================================================
   HEALTH
========================================================= */

app.get(
    "/health",
    (req, res) => {
        const songrec =
            getSongRecPath();

        let ffmpeg =
            false;

        let ffprobe =
            false;

        try {
            execFileSync(
                "ffmpeg",
                ["-version"],
                {
                    stdio: "ignore"
                }
            );

            ffmpeg = true;
        } catch (_) {}

        try {
            execFileSync(
                "ffprobe",
                ["-version"],
                {
                    stdio: "ignore"
                }
            );

            ffprobe = true;
        } catch (_) {}

        res.json({
            status:
                "ok",

            songrec:
                !!songrec,

            songrecPath:
                songrec || null,

            ffmpeg:
                ffmpeg,

            ffprobe:
                ffprobe,

            lyricsSources: [
                "LRCLIB exact",
                "LRCLIB search",
                "lyrics.ovh",
                "AUDD"
            ]
        });
    }
);

/* =========================================================
   START
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