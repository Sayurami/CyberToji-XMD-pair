// api/pair.js — Vercel Serverless Function
// Génère un pairing code WhatsApp via Baileys

import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason
} from 'bail-lite';
import pino from 'pino';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Sessions stockées en mémoire (Vercel est stateless — voir note ci-dessous)
const sessions = new Map();

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Méthode non autorisée' });
  }

  const { phone } = req.body || {};

  if (!phone || typeof phone !== 'string') {
    return res.status(400).json({ error: 'Numéro de téléphone requis' });
  }

  // Nettoyer le numéro
  const cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.length < 7 || cleanPhone.length > 15) {
    return res.status(400).json({ error: 'Numéro invalide' });
  }

  try {
    const code = await getPairingCode(cleanPhone);
    return res.status(200).json({ code, phone: cleanPhone });
  } catch (err) {
    console.error('[PAIR ERROR]', err.message);
    return res.status(500).json({ error: err.message || 'Erreur lors de la génération du code' });
  }
}

async function getPairingCode(phone) {
  // Dossier temporaire pour la session
  const sessionDir = path.join(os.tmpdir(), 'cybertoji_pair_' + phone);
  await fs.mkdir(sessionDir, { recursive: true });

  return new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timeout — réessaie dans quelques secondes'));
    }, 30000);

    try {
      const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
      const { version } = await fetchLatestBaileysVersion();

      const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['CYBERTOJI XMD', 'Chrome', '120.0'],
      });

      sock.ev.on('creds.update', saveCreds);

      // Générer le code dès que le socket est prêt
      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
          // Déjà connecté — pas besoin de code
          clearTimeout(timeout);
          sock.end();
          reject(new Error('Ce numéro est déjà connecté'));
          return;
        }

        // Générer le pairing code
        if (!sock.authState.creds.registered) {
          try {
            await new Promise(r => setTimeout(r, 2000)); // attendre l'init
            const code = await sock.requestPairingCode(phone);
            clearTimeout(timeout);
            // Formater le code: XXXX-XXXX
            const formatted = code?.match(/.{1,4}/g)?.join('-') || code;
            sock.end();
            resolve(formatted);
          } catch (e) {
            clearTimeout(timeout);
            sock.end();
            reject(new Error('Impossible de générer le code: ' + e.message));
          }
        }

        if (connection === 'close') {
          const code = lastDisconnect?.error?.output?.statusCode;
          if (code !== DisconnectReason.loggedOut) {
            // Reconnexion normale, ignorer
          }
        }
      });

    } catch (err) {
      clearTimeout(timeout);
      reject(err);
    }
  });
}
