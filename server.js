require("dotenv").config();

const express = require("express");
const multer = require("multer");
const fs = require("fs");

const app = express();

const upload = multer({ dest: "uploads/" });

app.use(express.static("."));

app.post("/identify", upload.single("audio"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                error: "No audio file received."
            });
        }

        const formData = new FormData();

        formData.append(
            "api_token",
            process.env.AUDD_TOKEN
        );

        formData.append(
            "file",
            new Blob([
                fs.readFileSync(req.file.path)
            ]),
            "music.webm"
        );

        const response = await fetch(
            "https://api.audd.io/",
            {
                method: "POST",
                body: formData
            }
        );

        const data = await response.json();

        // Delete temporary recording
        if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        if (!data.result) {
            return res.json({
                error: "Song not identified."
            });
        }

        const song = data.result;

        // Get synchronized lyrics
        const lyricsResponse = await fetch(
            "https://lrclib.net/api/get?" +
            "track_name=" +
            encodeURIComponent(song.title) +
            "&artist_name=" +
            encodeURIComponent(song.artist)
        );

        let lyrics = null;

        if (lyricsResponse.ok) {
            lyrics = await lyricsResponse.json();
        }

        res.json({
            song: {
                title: song.title,
                artist: song.artist,
                timecode: song.timecode
            },
            lyrics: lyrics
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: "Server error: " + error.message
        });
    }
});

app.listen(3000, () => {
    console.log(
        "🎵 Music Lyrics server running on port 3000"
    );
});