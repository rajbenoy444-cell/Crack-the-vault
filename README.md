# Crack the Vault ⚡ (Cyberpunk CS Interrogation Game)

**Crack the Vault** is an interactive, full-stack computer science guessing game powered by an AI Oracle. An AI Oracle holds a secret technical term across 4 core Computer Science domains. Participants interrogate the Oracle with yes/no questions, receiving subtle, concise hints to crack the vault in 20 moves or less.

---

## Key Features

1. **7 Admin Room Categories**:
   - **Programming Languages** (e.g. Python, JavaScript, Rust, TypeScript, C++)
   - **UI/UX Designs** (e.g. Wireframe, Glassmorphism, Design System, Typography, Micro-interaction)
   - **Language Authors** (e.g. Guido van Rossum, Brendan Eich, Dennis Ritchie, Bjarne Stroustrup)
   - **Cloud** (e.g. Kubernetes, Docker, Amazon S3, Serverless, AWS Lambda)
   - **Data Structures** (e.g. Linked List, Binary Tree, Hash Table, Stack, Trie)
   - **MNC Company Details** (e.g. Google, Microsoft, Apple, Amazon, Meta)
   - **MNC Quotes** (e.g. Move Fast and Break Things, Stay Hungry Stay Foolish, Think Different)

2. **Dual Term Selection Modes**:
   - **AI-Generated Terms**: Generates secret technical terms automatically using Claude Sonnet.
   - **Manual Custom Terms**: Admin hosts can input custom terms along with optional rules/context notes.

3. **Isolated Participant Vault Experience**:
   - Participants play in complete tactical isolation.
   - **No participant leaderboards or competitor stats visible** — players feel alone interrogating the vault.

4. **Real-Time Admin Live Dashboard**:
   - Admins get a dedicated monitor console powered by **Server-Sent Events (SSE)**.
   - Live telemetry feed displaying connected players, live question logs, hints given, and win/loss status in real-time.

5. **Subtle Oracle Hints**:
   - Formulated with precise rules: answers with a classification label ("Yes", "No", "Partially", "Invalid") accompanied by a **terse, helpful hint (under 10 words)** without leaking letter counts or spelling.

6. **Zero-Lockout Fallback**:
   - Includes a smart local fallback engine so the application remains 100% playable even without an API key or when offline.

---

## Project Structure

```
crack-the-vault/
├── package.json         # Node.js dependencies (Express, CORS, dotenv)
├── server.js            # Express server, SSE streaming, & Oracle LLM integration
├── Dockerfile           # Docker container configuration
├── docker-compose.yml   # Docker Compose orchestration
├── .env.example         # Environment template
└── public/              # Static Frontend Web App
    ├── index.html       # Cyberpunk HTML layout
    ├── styles.css       # Custom dark theme styles & animations
    └── app.js           # Single-Page App logic & event handlers
```

---

## Local Quickstart

### Prerequisites
- [Node.js](https://nodejs.org/) v18+ and npm installed.

### Steps
1. Clone or navigate to the repository directory:
   ```bash
   cd crack-the-vault
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. *(Optional)* Configure environment variables in `.env`:
   ```bash
   cp .env.example .env
   ```
   Add your Anthropic API Key (`ANTHROPIC_API_KEY=sk-ant-...`). If left blank, the server uses its smart offline fallback engine.

4. Start the server:
   ```bash
   npm start
   ```
5. Open your browser at **`http://localhost:3000`**.

---

## Production Deployment Methods

### Method 1: Render / Railway / Heroku (Recommended for Full SSE Telemetry)

For full real-time Server-Sent Events (SSE) live admin monitoring:

#### Render.com Deployment:
1. Push your repository to GitHub/GitLab.
2. Log into [Render.com](https://render.com) and click **New > Web Service**.
3. Connect your repository.
4. Select Environment: **Node**.
5. Build Command: `npm install`
6. Start Command: `node server.js`
7. Add Environment Variable under settings:
   - `ANTHROPIC_API_KEY` = `your_actual_key`
8. Click **Create Web Service**.

---

### Method 2: Docker Container Deployment

Run the pre-configured Docker container on any VPS (DigitalOcean, AWS EC2, Linode, GCP):

```bash
# 1. Build and launch with Docker Compose
docker-compose up -d --build

# 2. Check container logs
docker-compose logs -f
```

---

### Method 3: Vercel / Netlify (Serverless Hosting)

To deploy on Vercel:
1. Install Vercel CLI: `npm i -g vercel`
2. Create a `vercel.json` file in the root directory:
   ```json
   {
     "version": 2,
     "builds": [
       { "src": "server.js", "use": "@vercel/node" },
       { "src": "public/**/*", "use": "@vercel/static" }
     ],
     "routes": [
       { "src": "/api/(.*)", "dest": "/server.js" },
       { "src": "/(.*)", "dest": "/public/$1" }
     ]
   }
   ```
3. Run `vercel --prod` and set the `ANTHROPIC_API_KEY` environment variable in the Vercel Dashboard.

---

## License
MIT License. Built with Google Antigravity & Anthropic Claude APIs.
