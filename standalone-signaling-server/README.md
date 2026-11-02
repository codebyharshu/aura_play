# SyncWave Standalone Internet Signaling Server

A lightweight, zero-cost WebRTC signaling and receiver web hosting service for **SyncWave Internet Mode**.

## Why this service is needed
When a desktop is on one network (e.g. Jio 5G or Home Wi-Fi) and receivers are on different networks (Airtel 5G, BSNL 4G, or mobile hotspots in another city), they cannot reach each other directly via local IP addresses.

This server provides:
1. **Public Rendezvous Point:** Connects the desktop host and mobile receivers.
2. **WebRTC Signaling:** Mediates SDP Offer, Answer, and ICE candidate exchange.
3. **Public Web Host:** Serves the mobile receiver HTML5 web application over HTTPS.
4. **Fallback Audio Relay:** Automatically forwards audio if extreme enterprise firewalls block UDP WebRTC packets.

---

## 1-Minute Free Cloud Deployment

### Option A: Render.com (100% Free Tier)
1. Fork or push this repository to your GitHub.
2. Log into [Render.com](https://render.com) and click **New Web Service**.
3. Connect your repository and set the **Root Directory** to `standalone-signaling-server`.
4. Build Command: `npm install`
5. Start Command: `node server.js`
6. Click **Deploy**. Render gives you a free HTTPS URL: `https://your-service.onrender.com`.
7. Paste this URL into SyncWave Desktop under **Internet Mode Settings**.

### Option B: Railway.app (Free / Low Cost)
1. Log into [Railway.app](https://railway.app) and create a **New Project from GitHub Repo**.
2. Select `standalone-signaling-server`.
3. Railway automatically detects Node.js and deploys your public HTTPS/WSS URL.

### Option C: Self-Hosted on Any VPS (Ubuntu / Debian / AWS EC2)
```bash
cd standalone-signaling-server
npm install
node server.js
```
Use Nginx or Caddy with Let's Encrypt for automatic HTTPS:
```nginx
location / {
    proxy_pass http://localhost:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```
