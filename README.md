# 🤖 CYBERTOJI XMD — Pairing Site

Site de pairing WhatsApp pour le bot CYBERTOJI XMD.

## 📁 Structure
```
cybertoji-pair/
├── api/
│   └── pair.js        ← API backend (génère le code)
├── public/
│   └── index.html     ← Frontend (le site)
├── vercel.json        ← Config Vercel
└── package.json
```

## 🚀 Déploiement sur Vercel

### Méthode 1 — Via GitHub (recommandé)
1. Crée un repo GitHub et upload ces fichiers
2. Va sur https://vercel.com → New Project
3. Importe ton repo GitHub
4. Clique **Deploy** — c'est tout !

### Méthode 2 — Via Vercel CLI
```bash
npm install -g vercel
vercel login
vercel --prod
```

## ⚙️ Comment ça marche
1. L'utilisateur entre son numéro sur le site
2. Le site appelle `/api/pair` avec le numéro
3. Le backend crée un socket Baileys temporaire
4. Baileys génère un code d'appairage de 8 caractères
5. Le code s'affiche sur le site
6. L'utilisateur entre le code dans WhatsApp → Bot connecté ✅

## ⚠️ Note importante
Vercel est **stateless** — chaque requête est indépendante.
La session du bot principal doit être gérée séparément sur ton hébergeur (panel Pterodactyl).
Ce site sert uniquement à **générer le code de pairing**.
