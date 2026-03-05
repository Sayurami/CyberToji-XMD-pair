const fs = require('fs');
const path = require('path');
const express = require('express');
const router = express.Router();
const pino = require("pino");
const archiver = require("archiver");
const sessionSockets = new Map();

process.on("uncaughtException", console.log);
process.on("unhandledRejection", console.log);

const {
default: makeWASocket,
useMultiFileAuthState,
fetchLatestBaileysVersion,
makeCacheableSignalKeyStore,
DisconnectReason
} = require("@whiskeysockets/baileys");

/*
====================================================
CONFIG
====================================================
*/

const SESSION_ROOT = "./session_pair";

if (!fs.existsSync(SESSION_ROOT)) {
    fs.mkdirSync(SESSION_ROOT, { recursive: true });
}

/*
====================================================
SOCKET STARTER
====================================================
*/

async function startSocket(sessionPath, sessionKey) {

const { version } = await fetchLatestBaileysVersion();

const { state, saveCreds } =
    await useMultiFileAuthState(sessionPath);

const sock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    keepAliveIntervalMs: 5000,
    auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys)
    },
    browser: ["Ubuntu", "Chrome", "20.0.04"]
});

if (!sock.heartbeat) {
    sock.heartbeat = setInterval(async () => {
        try {
            if (!sock?.ws?.socket) return;
            if (sock.ws.socket.readyState !== 1) return;
            await sock.sendPresenceUpdate("available");
        } catch {}
    }, 25000);
}

if (sessionKey) {
    sessionSockets.set(sessionKey, sock);
}

/*
====================================================
MESSAGE HANDLER
====================================================
*/

sock.ev.on("messages.upsert", async (chatUpdate) => {
    try {
        if (!chatUpdate?.messages) return;
        await handleMessages(sock, chatUpdate, true);
    } catch (err) {
        console.log("Runtime handler error:", err);
    }
});

sock.ev.on("creds.update", saveCreds);

sock.ev.on("connection.update", async (update) => {

    const { connection, lastDisconnect } = update;

    if (connection === "open") {

        await new Promise(r => setTimeout(r, 2000));

        if (!state?.creds?.me?.id) return;

        const cleanNumber =
            state.creds.me.id.split(":")[0];

        const trackFile = "./data/paired_users.json";
        let users = [];

        try {
            users = JSON.parse(fs.readFileSync(trackFile, "utf8"));
        } catch {
            users = [];
        }

        if (!users.some(u => u.number === cleanNumber)) {
            users.push({ number: cleanNumber });
            fs.writeFileSync(trackFile, JSON.stringify(users, null, 2));
        }

        console.log("✅ Session Connected:", cleanNumber);
    }

    if (connection === "close") {

        const status =
            lastDisconnect?.error?.output?.statusCode;

        sessionSockets.delete(sessionKey);

        if (status !== DisconnectReason.loggedOut) {
            setTimeout(() => {
                startSocket(sessionPath, sessionKey);
            }, 5000);
        } else {
            if (fs.existsSync(sessionPath)) {
                fs.rmSync(sessionPath, { recursive: true, force: true });
            }
        }
    }
});

return sock;
}

/*
====================================================
PAIR PAGE
====================================================
*/

router.get('/', (req, res) => {
    res.sendFile(process.cwd() + "/pair.html");
});

/*
====================================================
PAIR CODE API
====================================================
*/

router.get('/code', async (req, res) => {

try {

    let number = req.query.number;

    if (!number)
        return res.json({ error: "Number Required" });

    number = number.replace(/[^0-9]/g, '');

    const sessionPath =
        path.join(SESSION_ROOT, number);

    if (fs.existsSync(sessionPath)) {
        fs.rmSync(sessionPath, { recursive: true, force: true });
    }

    fs.mkdirSync(sessionPath, { recursive: true });

    sessionSockets.delete(number);

    const sock = await startSocket(sessionPath, number);

    await new Promise(r => setTimeout(r, 2000));

    const code =
        await sock.requestPairingCode(number);

    return res.json({
        code: code?.match(/.{1,4}/g)?.join("-") || code,
        download: `/download?number=${number}`
    });

} catch (err) {

    console.log("Pairing Error:", err);

    return res.json({
        error: "Service Unavailable"
    });
}

});

/*
====================================================
DOWNLOAD SESSION (ZIP)
====================================================
*/

router.get('/download', async (req, res) => {

    const number = req.query.number;

    if (!number)
        return res.json({ error: "Number required" });

    const sessionPath = path.join(SESSION_ROOT, number);

    if (!fs.existsSync(sessionPath))
        return res.json({ error: "Session not found" });

    const zipPath = path.join(SESSION_ROOT, `${number}.zip`);

    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.pipe(output);
    archive.directory(sessionPath, false);
    await archive.finalize();

    output.on("close", () => {

        res.download(zipPath, `${number}.zip`, () => {
            if (fs.existsSync(zipPath)) {
                fs.unlinkSync(zipPath);
            }
        });

    });

});

/*
====================================================
AUTO RESTORE
====================================================
*/

setTimeout(async () => {
    try {

        const folders = fs.readdirSync(SESSION_ROOT);

        for (const number of folders) {

            const sessionPath = path.join(SESSION_ROOT, number);

            if (fs.lstatSync(sessionPath).isDirectory()) {
                console.log("🔄 Restoring:", number);
                await startSocket(sessionPath, number);
            }
        }

    } catch (err) {
        console.log("Session restore error:", err);
    }
}, 5000);

module.exports = router;
