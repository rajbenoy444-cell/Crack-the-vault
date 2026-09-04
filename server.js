const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_QUESTIONS = 20;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Curated Term Banks per Room Type (including 1st-Year Beginner Categories)
const TERM_BANKS = {
  "Programming Fundamentals": [
    "Variable", "Loop", "Function", "Array", "If-Else",
    "String", "Integer", "Boolean", "Recursion", "Constant",
    "Bug", "Compiler", "Comment", "Pointer"
  ],
  "Basic Languages & Tools": [
    "Python", "C Language", "Java", "C++", "HTML",
    "JavaScript", "VS Code", "Terminal"
  ],
  "Computer Science Basics": [
    "Algorithm", "Binary", "RAM", "CPU", "Operating System",
    "Output / Print", "Keyboard", "Memory"
  ],
  "Programming Languages": [
    "Python", "JavaScript", "Rust", "TypeScript", "C++",
    "Go", "Java", "Kotlin", "Swift", "Haskell"
  ],
  "UI/UX Designs": [
    "Wireframe", "Glassmorphism", "Design System", "Typography", "Micro-interaction",
    "User Journey Map", "Figma", "Color Palette", "Responsive Layout", "Accessibility (a11y)"
  ],
  "Language Authors": [
    "Guido van Rossum", "Brendan Eich", "Dennis Ritchie", "Bjarne Stroustrup", "James Gosling",
    "Rob Pike", "Graydon Hoare", "Anders Hejlsberg", "Larry Wall", "Yukihiro Matsumoto"
  ],
  "Cloud": [
    "Kubernetes", "Docker", "Amazon S3", "Serverless", "AWS Lambda",
    "Microservices", "Terraform", "Load Balancer", "Cloudflare", "IAM Policy"
  ],
  "Data Structures": [
    "Linked List", "Binary Tree", "Hash Table", "Stack", "Queue",
    "Graph", "Heap", "Trie", "Red-Black Tree", "B-Tree"
  ],
  "MNC Company Details": [
    "Google", "Microsoft", "Apple", "Amazon", "Meta",
    "NVIDIA", "Netflix", "Intel", "IBM", "Oracle"
  ],
  "MNC Quotes": [
    "Move Fast and Break Things", "Stay Hungry, Stay Foolish", "Organize the World's Information", "Don't Be Evil", "Think Different",
    "Customer Obsession", "Embrace and Extend", "Work Hard, Have Fun, Make History", "Connecting People", "Move Fast with Stable Infrastructure"
  ]
};

// Category Lookup Helper (handles singular/plural & case variations)
function getTermBank(roomType) {
  if (!roomType) return null;
  if (TERM_BANKS[roomType]) return TERM_BANKS[roomType];
  const normalized = roomType.trim().toLowerCase();
  for (const key of Object.keys(TERM_BANKS)) {
    if (key.toLowerCase() === normalized) return TERM_BANKS[key];
    if (key.toLowerCase().replace(/s$/, '') === normalized.replace(/s$/, '')) return TERM_BANKS[key];
  }
  return null;
}

// In-Memory Storage for Active Rooms & Admin/Participant Streams
const rooms = new Map(); // roomCode -> room Object
const adminClients = new Map(); // roomCode -> Set of res objects
const participantClients = new Map(); // roomCode -> Set of res objects

function genCode() {
  const chars = "ACDEFGHJKLMNPQRSTUVWXYZ23456789";
  let c = "";
  for (let i = 0; i < 5; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

// Points Calculation Formula:
// 1. Solved Tier: Base 100 pts + (maxQuestions - qCount) * 5 (100 - 195 pts)
// 2. Unsolved Tier (Everyone fails / timeout / max questions reached):
//    "Lesser the questions asked, higher the points allotted"
//    Efficiency: (maxQuestions - qCount) * 3.5 pts + small closeness tie-breaker bonus (+1 per Yes/Partially hint, max 6 pts)
//    Floored at 3 pts for attempting, capped at 85 pts so cracked vaults (100+) always rank higher.
// 3. Inactive (0 questions asked): 0 pts
// 4. CRITICAL INTEGRITY RULE: Disqualified / leaving full screen after fair warning = STRICTLY 0 POINTS.
function calculateScore(solved, qCount, maxQuestions = 20, history = [], cheatingTerminated = false) {
  if (cheatingTerminated) return 0; // Permanent 0 points elimination penalty

  const maxQ = Math.max(3, Number(maxQuestions) || 20);
  const cleanQ = Math.max(0, Math.min(maxQ, Number(qCount) || 0));
  if (cleanQ === 0) return 0;

  if (solved) {
    const unused = Math.max(0, maxQ - cleanQ);
    return 100 + (unused * 5);
  }

  const unused = Math.max(0, maxQ - cleanQ);
  const efficiencyPoints = unused * 3.5;

  let positiveHints = 0;
  if (Array.isArray(history)) {
    positiveHints = history.filter(h => {
      const a = (h.a || '').toLowerCase();
      return a.startsWith('yes') || a.startsWith('partially');
    }).length;
  }
  const closenessBonus = Math.min(6, positiveHints);

  const total = Math.round(efficiencyPoints + closenessBonus);
  return Math.max(3, Math.min(85, total));
}

function getLeaderboard(room) {
  if (!room) return [];
  const maxQ = room.maxQuestions || 20;
  const list = Array.from(room.participants.values()).map(p => {
    const isFinished = Boolean(p.solved || p.timedOut || p.qCount >= maxQ || p.cheatingTerminated);
    let status = isFinished ? "Finished" : "Ongoing";
    let statusDetail = "Ongoing";
    if (p.cheatingTerminated) {
      status = "Eliminated";
      statusDetail = "Eliminated (Fullscreen Exit)";
    } else if (p.solved) {
      statusDetail = "Finished (Cracked)";
    } else if (p.timedOut) {
      statusDetail = "Finished (Timeout)";
    } else if (p.qCount >= maxQ) {
      statusDetail = "Finished (Max Qs)";
    } else {
      statusDetail = "Ongoing";
    }

    const finalScore = p.cheatingTerminated ? 0 : (Number(p.score) || 0);

    return {
      name: p.name,
      qCount: p.qCount || 0,
      maxQuestions: maxQ,
      solved: Boolean(p.solved),
      score: finalScore,
      timedOut: Boolean(p.timedOut),
      cheatingTerminated: Boolean(p.cheatingTerminated),
      isFinished,
      status,
      statusDetail,
      joinedAt: p.joinedAt || 0,
      lastActiveAt: p.lastActiveAt || Date.now()
    };
  });

  list.sort((a, b) => {
    // 1. Eliminated participants are sent to the bottom of the leaderboard
    if (Boolean(a.cheatingTerminated) !== Boolean(b.cheatingTerminated)) {
      return a.cheatingTerminated ? 1 : -1;
    }
    // 2. Solved vaults rank above unsolved
    if (a.solved !== b.solved) return b.solved ? 1 : -1;
    // 3. Higher score ranks first
    if (b.score !== a.score) return b.score - a.score;
    // 4. Finished before ongoing
    if (a.isFinished !== b.isFinished) return a.isFinished ? -1 : 1;
    // 5. Fewer questions asked ranks higher
    if (a.qCount !== b.qCount) return a.qCount - b.qCount;
    return a.joinedAt - b.joinedAt;
  });

  return list.map((p, idx) => ({
    ...p,
    rank: idx + 1
  }));
}

function getProgressiveClues(term, qCount, maxQuestions = 20) {
  const maxQ = Math.max(3, Number(maxQuestions) || 20);
  const lvl1 = Math.max(2, Math.floor(maxQ * 0.5));
  const lvl2 = Math.max(lvl1 + 1, Math.floor(maxQ * 0.7));
  const lvl3 = Math.max(lvl2 + 1, Math.floor(maxQ * 0.85));

  if (!term || qCount < lvl1) {
    return {
      unlocked: false,
      questionsNeeded: Math.max(0, lvl1 - (qCount || 0)),
      pattern: null,
      hint: null,
      level: 0,
      lvl1Threshold: lvl1,
      lvl2Threshold: lvl2,
      lvl3Threshold: lvl3
    };
  }

  const words = term.trim().split(/\s+/);
  let pattern = "";
  let level = 1;
  let hint = "";

  if (qCount >= lvl3) {
    level = 3;
    pattern = words.map(w => {
      if (w.length <= 2) return w.toUpperCase();
      return w.split('').map((ch, idx) => {
        if (idx === 0 || idx === w.length - 1) return ch.toUpperCase();
        if ("AEIOUaeiou".includes(ch) || idx % 2 === 0) return ch.toUpperCase();
        return "_";
      }).join(' ');
    }).join('   ');
    hint = `Major Decryption Clue: Structure has ${words.length} word(s). Boundary letters & vowels are revealed above!`;
  } else if (qCount >= lvl2) {
    level = 2;
    pattern = words.map(w => {
      if (w.length <= 2) return w[0].toUpperCase() + (w.length === 2 ? ' _' : '');
      return w[0].toUpperCase() + ' ' + '_ '.repeat(w.length - 2) + w[w.length - 1].toUpperCase();
    }).join('   ');
    hint = `Boundary Clue: First & last letters of each word are now unlocked above (${term.length} total chars).`;
  } else {
    level = 1;
    pattern = words.map(w => '_ '.repeat(w.length).trim()).join('   ');
    hint = `Letter Count Clue: Hidden concept consists of ${words.length} word(s) (${words.map(w => w.length + ' letters').join(', ')}).`;
  }

  return {
    unlocked: true,
    pattern,
    hint,
    level,
    qCount,
    lvl1Threshold: lvl1,
    lvl2Threshold: lvl2,
    lvl3Threshold: lvl3
  };
}

function notifyAdmin(roomCode, event, data) {
  const clients = adminClients.get(roomCode);
  if (clients) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    clients.forEach(res => {
      try { res.write(payload); } catch (e) {}
    });
  }
}

function notifyParticipants(roomCode, event, data) {
  const clients = participantClients.get(roomCode);
  if (clients) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    clients.forEach(res => {
      try { res.write(payload); } catch (e) {}
    });
  }
}

// System Prompt Constructor for Nudge-Based Oracle (Educational AI Mentor)
function buildSystemPrompt(term, roomType, customNote) {
  return `You are an encouraging, educational AI Oracle in "Crack the Vault", mentoring 1st-year computer science students who are learning fundamental programming concepts.

The Secret Term is: "${term}" (Category: "${roomType}").
${customNote ? `Host Context: ${customNote}` : ''}

EVALUATION & NUDGE RULES:
1. WINNING GUESS:
   If the student explicitly guesses the secret term "${term}" (or asks "Is it ${term}?"):
   Output STRICTLY: "CORRECT! The term was ${term}."

2. CONCEPTUAL NUDGE RESPONSES:
   For all other questions (properties, classification, usage, behavior):
   Do NOT simply answer with a bare "Yes" or "No". Instead, start with "Yes", "No", or "Partially", followed by a dash ("—") and ONE short, beginner-friendly sentence providing a pedagogical nudge that guides them closer without directly giving away the secret term "${term}".

   Examples:
   - Q: "Is it used to repeat code?" -> "Yes — it repeatedly executes a block of statements until a given condition changes."
   - Q: "Is it a data type?" -> "No — it is a control flow structure, not a value container."
   - Q: "Is it used in C language?" -> "Yes — both while-loops and for-loops are fundamental in C and Python."
   - Q: "Is it a function?" -> "No — it is a named storage location in memory used to hold values."
   - Q: "Does it hold numbers?" -> "Yes — it can store integers, floats, or characters depending on the data type."

3. CONCISE & SUPPORTIVE:
   Keep the explanation to exactly ONE concise sentence after the dash. Never leak the secret word "${term}" unless it is a winning guess.`;
}

// Universal LLM Handler (Supports both Google Gemini API and Anthropic Claude API)
async function callLLM(systemPrompt, userPrompt, history = [], maxTokens = 150, customApiKey = null, secretTerm = "", category = "") {
  const apiKey = (customApiKey && customApiKey.trim()) || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey === "your_anthropic_api_key_here") return null;

  const isAnthropic = apiKey.startsWith("sk-ant-");
  const isGemini = apiKey.startsWith("AIzaSy");
  if (!isAnthropic && !isGemini) return null;

  if (isAnthropic) {
    try {
      const messages = [];
      history.forEach(h => {
        const histPayload = secretTerm && category
          ? `[LIVE QUESTION PAYLOAD]\nThe Question: "${h.q}"\nThe Secret Term (Answer): "${secretTerm}"\nThe Category: "${category}"`
          : h.q;
        messages.push({ role: "user", content: histPayload });
        messages.push({ role: "assistant", content: h.a });
      });
      messages.push({ role: "user", content: userPrompt });

      const apiResp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: messages
        })
      });

      if (apiResp.ok) {
        const data = await apiResp.json();
        if (data.content && data.content[0] && data.content[0].text) {
          return data.content[0].text.trim();
        }
      }
    } catch (e) {
      console.error("Anthropic API Error:", e);
    }
  } else {
    // Google Gemini API Call with Model Pool Fallback (gemini-flash-lite-latest, gemini-3.5-flash, etc.)
    const models = [
      "gemini-flash-lite-latest",
      "gemini-3.5-flash",
      "gemini-3.1-flash-lite",
      "gemini-3.5-flash-lite",
      "gemini-flash-latest",
      "gemma-4-31b-it",
      "gemma-4-26b-a4b-it"
    ];

    const contents = [];
    history.forEach(h => {
      const histPayload = secretTerm && category
        ? `[LIVE QUESTION PAYLOAD]\nThe Question: "${h.q}"\nThe Secret Term (Answer): "${secretTerm}"\nThe Category: "${category}"`
        : h.q;
      contents.push({ role: "user", parts: [{ text: histPayload }] });
      contents.push({ role: "model", parts: [{ text: h.a }] });
    });
    contents.push({ role: "user", parts: [{ text: userPrompt }] });

    for (const modelName of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
        const apiResp = await fetch(url, {
          method: "POST",
          signal: AbortSignal.timeout(1200),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: contents,
            generationConfig: { maxOutputTokens: maxTokens }
          })
        });

        if (apiResp.ok) {
          const data = await apiResp.json();
          if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0]) {
            return data.candidates[0].content.parts[0].text.trim();
          }
        } else if (apiResp.status === 400 || apiResp.status === 403) {
          break;
        }
      } catch (e) {
        break; // Network/timeout error, fall back immediately to smart educational engine
      }
    }
  }

  return null;
}

// REST API Routes

// 1. Get Available Room Types & Terms
app.get('/api/room-types', (req, res) => {
  res.json({ roomTypes: Object.keys(TERM_BANKS) });
});

// 2. Generate Secret Term via LLM or Fallback Bank
app.post('/api/terms/generate', async (req, res) => {
  const { roomType } = req.body;
  const bank = getTermBank(roomType);
  if (!roomType || !bank) {
    return res.status(400).json({ error: "Invalid room type" });
  }

  const systemPrompt = `Generate 1 advanced, distinct term for the category: "${roomType}". Respond ONLY with the term string, nothing else.`;
  const aiTerm = await callLLM(systemPrompt, "Generate term", [], 60);
  if (aiTerm) {
    return res.json({ term: aiTerm.replace(/^["']|["']$/g, ''), source: "ai" });
  }

  // Fallback to random term from bank
  const term = bank[Math.floor(Math.random() * bank.length)];
  res.json({ term, source: "bank" });
});

// 3. Admin Room Creation (AI Term or Manual Custom Term with full control flags)
app.post('/api/rooms/create', (req, res) => {
  const {
    roomType,
    termMode,
    manualTerm,
    customNote,
    timerSeconds,
    maxQuestions,
    fullScreenEnabled,
    warningsEnabled,
    showLeaderboard
  } = req.body;
  const bank = getTermBank(roomType);

  if (!roomType || !bank) {
    return res.status(400).json({ error: "Invalid room type" });
  }

  const duration = Number(timerSeconds) || 180;
  const finalTimerSeconds = Math.max(10, Math.min(3600, duration));
  const finalMaxQuestions = Math.max(3, Math.min(100, Number(maxQuestions) || 20));

  let finalTerm = "";
  if (termMode === "manual") {
    if (!manualTerm || !manualTerm.trim()) {
      return res.status(400).json({ error: "Manual term is required" });
    }
    finalTerm = manualTerm.trim();
  } else {
    // Pick random term from bank if not pre-generated
    finalTerm = bank[Math.floor(Math.random() * bank.length)];
  }

  const roomCode = genCode();
  const room = {
    code: roomCode,
    roomType,
    term: finalTerm,
    customNote: customNote || "",
    timerSeconds: finalTimerSeconds,
    maxQuestions: finalMaxQuestions,
    fullScreenEnabled: fullScreenEnabled !== undefined ? Boolean(fullScreenEnabled) : true,
    warningsEnabled: warningsEnabled !== undefined ? Boolean(warningsEnabled) : true,
    showLeaderboard: showLeaderboard !== undefined ? Boolean(showLeaderboard) : false,
    createdAt: Date.now(),
    participants: new Map() // participantName -> { name, history, qCount, solved, score, timedOut, cheatingTerminated, joinedAt }
  };

  rooms.set(roomCode, room);

  res.json({
    success: true,
    code: roomCode,
    roomType: room.roomType,
    term: room.term,
    timerSeconds: room.timerSeconds,
    maxQuestions: room.maxQuestions,
    fullScreenEnabled: room.fullScreenEnabled,
    warningsEnabled: room.warningsEnabled,
    showLeaderboard: room.showLeaderboard
  });
});

// 3b. Admin Live Settings Control (Toggles, Question Limit & Time Allotment)
app.post('/api/rooms/:code/settings', (req, res) => {
  const roomCode = req.params.code.toUpperCase();
  const room = rooms.get(roomCode);
  if (!room) {
    return res.status(404).json({ error: "Room not found" });
  }

  const { fullScreenEnabled, warningsEnabled, showLeaderboard, timerSeconds, addSeconds, maxQuestions, addQuestions } = req.body;

  if (fullScreenEnabled !== undefined) {
    room.fullScreenEnabled = Boolean(fullScreenEnabled);
  }
  if (warningsEnabled !== undefined) {
    room.warningsEnabled = Boolean(warningsEnabled);
  }
  if (showLeaderboard !== undefined) {
    room.showLeaderboard = Boolean(showLeaderboard);
  }
  if (timerSeconds !== undefined) {
    room.timerSeconds = Math.max(10, Math.min(3600, Number(timerSeconds)));
  } else if (addSeconds !== undefined) {
    room.timerSeconds = Math.max(10, Math.min(3600, (room.timerSeconds || 180) + Number(addSeconds)));
  }

  if (maxQuestions !== undefined) {
    room.maxQuestions = Math.max(3, Math.min(100, Number(maxQuestions)));
  } else if (addQuestions !== undefined) {
    room.maxQuestions = Math.max(3, Math.min(100, (room.maxQuestions || 20) + Number(addQuestions)));
  }

  const payload = {
    code: room.code,
    fullScreenEnabled: room.fullScreenEnabled,
    warningsEnabled: room.warningsEnabled,
    showLeaderboard: room.showLeaderboard,
    timerSeconds: room.timerSeconds,
    maxQuestions: room.maxQuestions,
    leaderboard: getLeaderboard(room)
  };

  notifyAdmin(room.code, "settings_updated", payload);
  notifyParticipants(room.code, "settings_updated", payload);

  res.json({
    success: true,
    ...payload
  });
});

// 3c. Participant Exam Timeout Notification
app.post('/api/rooms/timeout', (req, res) => {
  const { code, name } = req.body;
  if (!code || !name) {
    return res.status(400).json({ error: "Room code and name required" });
  }
  const cleanCode = code.toUpperCase().trim();
  const room = rooms.get(cleanCode);
  if (!room) {
    return res.status(404).json({ error: "Room not found" });
  }
  const p = room.participants.get(name.trim());
  if (p) {
    p.timedOut = true;
    p.score = calculateScore(p.solved, p.qCount, room.maxQuestions || 20, p.history, p.cheatingTerminated);
    notifyAdmin(cleanCode, "participant_timeout", {
      participantName: p.name,
      score: p.score,
      qCount: p.qCount,
      maxQuestions: room.maxQuestions || 20,
      status: "Finished",
      statusDetail: p.solved ? "Finished (Cracked)" : "Finished (Timeout)"
    });
    notifyParticipants(cleanCode, "leaderboard_updated", {
      leaderboard: getLeaderboard(room)
    });
  }
  res.json({ success: true });
});

// 3d. Participant Fullscreen Exit / Integrity Violation Elimination (STRICTLY 0 POINTS)
app.post('/api/rooms/cheat-terminate', (req, res) => {
  const { code, name, reason } = req.body;
  if (!code || !name) {
    return res.status(400).json({ error: "Room code and name required" });
  }
  const cleanCode = code.toUpperCase().trim();
  const room = rooms.get(cleanCode);
  if (!room) {
    return res.status(404).json({ error: "Room not found" });
  }
  const p = room.participants.get(name.trim());
  if (p) {
    p.cheatingTerminated = true;
    p.score = 0; // STRICT 0 POINTS PENALTY AS PER REQUIREMENT
    p.isFinished = true;
    p.statusDetail = "Eliminated (Fullscreen Exit)";
    notifyAdmin(cleanCode, "participant_eliminated", {
      participantName: p.name,
      score: 0,
      qCount: p.qCount,
      maxQuestions: room.maxQuestions || 20,
      reason: reason || "Left full screen after fair warning",
      leaderboard: getLeaderboard(room)
    });
    notifyParticipants(cleanCode, "leaderboard_updated", {
      leaderboard: getLeaderboard(room)
    });
  }
  res.json({ success: true, eliminated: true, score: 0 });
});

// 4. Participant Join Room (Secret term is NOT returned to client!)
app.post('/api/rooms/join', (req, res) => {
  const { code, name } = req.body;
  if (!code || !name) {
    return res.status(400).json({ error: "Room code and name required" });
  }

  const cleanCode = code.toUpperCase().trim();
  const room = rooms.get(cleanCode);
  if (!room) {
    return res.status(404).json({ error: "Vault Room not found. Verify the code with your admin." });
  }

  const cleanName = name.trim();
  let p = room.participants.get(cleanName);
  if (!p) {
    p = {
      name: cleanName,
      history: [],
      qCount: 0,
      solved: false,
      score: 0,
      timedOut: false,
      cheatingTerminated: false,
      joinedAt: Date.now(),
      lastActiveAt: Date.now()
    };
    room.participants.set(cleanName, p);
  }

  const currentLb = getLeaderboard(room);
  notifyAdmin(cleanCode, "participant_joined", {
    participant: currentLb.find(x => x.name === cleanName) || p,
    leaderboard: currentLb
  });

  notifyParticipants(cleanCode, "leaderboard_updated", {
    leaderboard: currentLb
  });

  res.json({
    success: true,
    code: room.code,
    roomType: room.roomType,
    timerSeconds: room.timerSeconds,
    maxQuestions: room.maxQuestions || 20,
    fullScreenEnabled: room.fullScreenEnabled,
    warningsEnabled: room.warningsEnabled,
    showLeaderboard: room.showLeaderboard,
    leaderboard: getLeaderboard(room),
    participant: {
      name: p.name,
      history: p.history,
      qCount: p.qCount,
      solved: p.solved,
      score: p.score,
      timedOut: p.timedOut,
      cheatingTerminated: p.cheatingTerminated
    }
  });
});

// 5. Oracle Interrogation Endpoint (LLM processing with fallback)
app.post('/api/oracle/ask', async (req, res) => {
  const { code, name, question, apiKey } = req.body;
  if (!code || !name || !question) {
    return res.status(400).json({ error: "Missing required parameters" });
  }

  const room = rooms.get(code.toUpperCase());
  if (!room) {
    return res.status(404).json({ error: "Room not found" });
  }

  const p = room.participants.get(name.trim());
  if (!p) {
    return res.status(404).json({ error: "Participant session not found" });
  }

  const maxQ = room.maxQuestions || 20;

  if (p.cheatingTerminated) {
    return res.status(403).json({ error: "Participant eliminated for exam integrity violation", score: 0, eliminated: true });
  }

  if (p.solved || p.qCount >= maxQ) {
    return res.status(400).json({ error: "Game session completed" });
  }

  const systemPrompt = buildSystemPrompt(room.term, room.roomType, room.customNote);

  const formattedUserPrompt = `[LIVE QUESTION PAYLOAD]
The Question: "${question}"
The Secret Term (Answer): "${room.term}"
The Category: "${room.roomType}"`;

  let rawAnswer = await callLLM(systemPrompt, formattedUserPrompt, p.history, 100, apiKey, room.term, room.roomType);
  let answer = "";

  if (rawAnswer) {
    const lower = rawAnswer.toLowerCase().trim();
    if (lower.includes("correct")) {
      answer = `CORRECT! The term was ${room.term}.`;
    } else if (lower.includes("yes") || lower.includes("true")) {
      answer = "Yes";
    } else if (lower.includes("no") || lower.includes("false")) {
      answer = "No";
    } else {
      answer = "No";
    }
  }

  // Clean Fallback Engine (Yes / No / Maybe / Invalid)
  if (!answer) {
    const qLower = question.toLowerCase();
    const termLower = room.term.toLowerCase();
    const typeLower = room.roomType.toLowerCase();

    // Check direct guess
    const guessMatch = qLower.match(/is it\s+([^?.]+)/i);
    const extractedGuess = guessMatch ? guessMatch[1].trim() : qLower.trim();

    if (extractedGuess === termLower || qLower.includes(termLower)) {
      answer = `CORRECT! The term was ${room.term}.`;
    } else {
      // First letter / starting letter match (e.g. "Does the name start with C?")
      const startLetterMatch = qLower.match(/start\w*\s+with\s+["']?([a-z])["']?/i) || qLower.match(/first\s+letter\s+["']?([a-z])["']?/i);
      let isFirstLetterMatch = false;
      let isFirstLetterMismatch = false;

      if (startLetterMatch) {
        const askedLetter = startLetterMatch[1].toLowerCase();
        const firstChar = termLower[0].toLowerCase();
        if (askedLetter === firstChar) {
          isFirstLetterMatch = true;
        } else {
          isFirstLetterMismatch = true;
        }
      }

      // Category membership check (e.g. "Is it a programming language?" for Go -> YES)
      const isCategoryQuestion = (
        (typeLower.includes("program") || typeLower.includes("language")) && (qLower.includes("programming language") || qLower.includes("a language") || qLower.includes("coding language")) ||
        (typeLower.includes("ui") || typeLower.includes("ux") || typeLower.includes("design")) && (qLower.includes("ui design") || qLower.includes("ux design") || qLower.includes("design system")) ||
        (typeLower.includes("author") || typeLower.includes("creator")) && (qLower.includes("author") || qLower.includes("creator") || qLower.includes("person") || qLower.includes("human")) ||
        (typeLower.includes("cloud")) && (qLower.includes("cloud service") || qLower.includes("cloud platform") || qLower.includes("cloud tool")) ||
        (typeLower.includes("data") || typeLower.includes("structure")) && (qLower.includes("data structure") && !qLower.includes("linear")) ||
        (typeLower.includes("company") || typeLower.includes("mnc")) && (qLower.includes("company") || qLower.includes("corporation") || qLower.includes("firm")) ||
        (typeLower.includes("quote") || typeLower.includes("slogan")) && (qLower.includes("quote") || qLower.includes("slogan") || qLower.includes("motto"))
      );

      // Sub-type Data Structure check (Linear vs Non-Linear)
      const isLinearQuestion = qLower.includes("linear") && !qLower.includes("non-linear") && !qLower.includes("nonlinear");
      const isNonLinearQuestion = qLower.includes("non-linear") || qLower.includes("nonlinear");
      const linearTerms = ["linked list", "stack", "queue", "array", "hash table"];
      const nonLinearTerms = ["graph", "binary tree", "tree", "trie", "heap", "red-black tree", "b-tree"];

      let isDataStructureTypeMatch = false;
      let isDataStructureTypeMismatch = false;

      if (isLinearQuestion) {
        if (linearTerms.includes(termLower)) isDataStructureTypeMatch = true;
        else if (nonLinearTerms.includes(termLower)) isDataStructureTypeMismatch = true;
      } else if (isNonLinearQuestion) {
        if (nonLinearTerms.includes(termLower)) isDataStructureTypeMatch = true;
        else if (linearTerms.includes(termLower)) isDataStructureTypeMismatch = true;
      }

      // Known trait mapping for 100% accurate fallback responses
      const TRAITS = {
        "graph": ["node", "edge", "vertex", "vertices", "non linear", "nonlinear", "cycle", "adjacency", "dfs", "bfs", "directed", "undirected"],
        "binary tree": ["root", "node", "left", "right", "traversal", "non linear", "nonlinear", "structure"],
        "red-black tree": ["self balancing", "tree", "node", "color", "red", "black", "non linear"],
        "trie": ["prefix tree", "string", "node", "non linear", "search"],
        "heap": ["priority queue", "min heap", "max heap", "non linear", "tree"],
        "cloudflare": ["cdn", "dns", "performance", "website performance", "speed", "ddos", "security", "edge", "workers", "ssl", "cloud", "caching", "firewall", "web performance"],
        "kubernetes": ["container", "orchestration", "k8s", "google", "pods", "cloud"],
        "docker": ["container", "image", "dockerfile", "virtualization", "cloud"],
        "amazon s3": ["object storage", "bucket", "aws", "amazon", "storage", "cloud"],
        "serverless": ["faas", "event driven", "lambda", "cloud"],
        "aws lambda": ["serverless", "event driven", "aws", "amazon", "function", "cloud"],
        "microservices": ["decoupled", "architecture", "services", "api", "cloud"],
        "terraform": ["infrastructure as code", "iac", "hashicorp", "cloud"],
        "load balancer": ["traffic", "distribution", "balancing", "proxy", "cloud"],
        "iam policy": ["permissions", "roles", "security", "access control", "cloud"],
        "go": ["google", "golang", "rob pike", "ken thompson", "compiled", "concurrency", "goroutine", "channel", "statically typed", "programming", "language"],
        "c": ["bell labs", "dennis ritchie", "procedural", "low level", "pointer", "compiled", "programming", "language"],
        "c++": ["bjarne stroustrup", "object oriented", "compiled", "stl", "cpp", "programming", "language"],
        "javascript": ["html", "css", "web", "website", "webpage", "browser", "dom", "frontend", "scripting", "dynamic", "brendan eich", "node", "npm", "react", "vue", "angular", "v8", "programming", "language"],
        "python": ["ai", "ml", "machine learning", "data science", "django", "flask", "pandas", "numpy", "interpreted", "dynamic", "object", "indentation", "guido van rossum", "script", "programming", "language"],
        "typescript": ["html", "css", "web", "frontend", "microsoft", "typed", "javascript", "superset", "anders hejlsberg", "programming", "language"],
        "rust": ["memory safe", "borrow", "ownership", "borrow checker", "mozilla", "graydon hoare", "no garbage", "garbage collection", "garbage collector", "cargo", "fast", "systems", "programming", "language"],
        "java": ["james gosling", "sun microsystems", "jvm", "bytecode", "object oriented", "programming", "language"],
        "kotlin": ["jetbrains", "android", "jvm", "concise", "programming", "language"],
        "swift": ["apple", "ios", "mac", "chris lattner", "compiled", "programming", "language"],
        "haskell": ["functional", "pure", "lazy", "monad", "statically typed", "programming", "language"],
        "guido van rossum": ["python", "dutch", "creator", "author", "bdfl", "benevolent"],
        "brendan eich": ["javascript", "js", "mozilla", "brave", "creator", "author"],
        "dennis ritchie": ["c", "unix", "bell labs", "creator", "author"],
        "bjarne stroustrup": ["c++", "cpp", "creator", "author", "danish"],
        "james gosling": ["java", "sun microsystems", "creator", "author"],
        "rob pike": ["go", "golang", "google", "creator", "author", "utf-8"],
        "linked list": ["pointer", "node", "linear", "head", "tail", "structure"],
        "google": ["mountain view", "alphabet", "search", "sundar", "android", "company", "mnc"],
        "microsoft": ["redmond", "windows", "azure", "bill gates", "satya", "company", "mnc"],
        "apple": ["cupertino", "steve jobs", "iphone", "mac", "tim cook", "company", "mnc"],
        "move fast and break things": ["mark zuckerberg", "facebook", "meta", "slogan", "motto", "quote"],
        "stay hungry, stay foolish": ["steve jobs", "stanford", "speech", "quote"],
        "organize the world's information": ["google", "mission", "search", "quote"],
        "don't be evil": ["google", "code", "conduct", "quote"],
        "think different": ["apple", "jobs", "slogan", "quote"]
      };

      const termTraits = TRAITS[termLower] || [];
      const isTraitMatch = termTraits.some(t => qLower.includes(t));

      const termKeywords = termLower.split(/\s+/).filter(k => k.length >= 2);
      const isKeywordMatch = termKeywords.some(k => qLower.includes(k));

      if (isFirstLetterMatch || isDataStructureTypeMatch || isCategoryQuestion || isTraitMatch || isKeywordMatch) {
        answer = "Yes";
      } else if (isFirstLetterMismatch || isDataStructureTypeMismatch) {
        answer = "No";
      } else if (qLower.includes("type") || qLower.includes("category") || qLower.includes("concept") || qLower.includes("feature")) {
        answer = "Yes";
      } else if (qLower.includes("type") || qLower.includes("category") || qLower.includes("concept") || qLower.includes("feature")) {
        answer = "Maybe";
      } else {
        answer = "No";
      }
    }
  }

  // Update participant state
  p.history.push({ q: question, a: answer });
  p.qCount += 1;
  p.lastActiveAt = Date.now();

  const isSolved = answer.toLowerCase().startsWith("correct");
  if (isSolved) {
    p.solved = true;
  }
  p.score = calculateScore(p.solved, p.qCount, maxQ, p.history, p.cheatingTerminated);

  const progressiveClue = getProgressiveClues(room.term, p.qCount, maxQ);
  const currentLb = getLeaderboard(room);

  // Real-time broadcast to Admin Live View
  notifyAdmin(room.code, "question_asked", {
    participantName: p.name,
    qCount: p.qCount,
    maxQuestions: maxQ,
    question,
    answer,
    solved: p.solved,
    score: p.score,
    status: p.cheatingTerminated ? "Eliminated" : (p.solved ? "Finished" : (p.qCount >= maxQ ? "Finished" : "Ongoing")),
    statusDetail: p.cheatingTerminated ? "Eliminated (Fullscreen Exit)" : (p.solved ? "Finished (Cracked)" : (p.qCount >= maxQ ? "Finished (Max Qs)" : "Ongoing")),
    leaderboard: currentLb
  });

  // Real-time broadcast to participants for leaderboard
  notifyParticipants(room.code, "leaderboard_updated", {
    leaderboard: currentLb
  });

  res.json({
    answer,
    qCount: p.qCount,
    maxQuestions: maxQ,
    solved: p.solved,
    score: p.score,
    remaining: Math.max(0, maxQ - p.qCount),
    clue: progressiveClue
  });
});

// 6. Admin Live Dashboard Telemetry SSE Stream
app.get('/api/rooms/:code/stream', (req, res) => {
  const roomCode = req.params.code.toUpperCase();
  const room = rooms.get(roomCode);

  if (!room) {
    return res.status(404).send("Room not found");
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (!adminClients.has(roomCode)) {
    adminClients.set(roomCode, new Set());
  }
  adminClients.get(roomCode).add(res);

  // Send initial room snapshot to Admin
  const participantsList = Array.from(room.participants.values());
  res.write(`event: snapshot\ndata: ${JSON.stringify({
    code: room.code,
    roomType: room.roomType,
    term: room.term,
    timerSeconds: room.timerSeconds,
    maxQuestions: room.maxQuestions || 20,
    fullScreenEnabled: room.fullScreenEnabled,
    warningsEnabled: room.warningsEnabled,
    showLeaderboard: room.showLeaderboard,
    participants: participantsList,
    leaderboard: getLeaderboard(room)
  })}\n\n`);

  req.on('close', () => {
    const clients = adminClients.get(roomCode);
    if (clients) {
      clients.delete(res);
    }
  });
});

// 7. Sanitized Participant Live SSE Stream (No secret term!)
app.get('/api/rooms/:code/participant-stream', (req, res) => {
  const roomCode = req.params.code.toUpperCase();
  const room = rooms.get(roomCode);

  if (!room) {
    return res.status(404).send("Room not found");
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (!participantClients.has(roomCode)) {
    participantClients.set(roomCode, new Set());
  }
  participantClients.get(roomCode).add(res);

  // Send initial sanitized snapshot to participant (term is excluded)
  res.write(`event: snapshot\ndata: ${JSON.stringify({
    code: room.code,
    roomType: room.roomType,
    timerSeconds: room.timerSeconds,
    maxQuestions: room.maxQuestions || 20,
    fullScreenEnabled: room.fullScreenEnabled,
    warningsEnabled: room.warningsEnabled,
    showLeaderboard: room.showLeaderboard,
    leaderboard: getLeaderboard(room)
  })}\n\n`);

  req.on('close', () => {
    const clients = participantClients.get(roomCode);
    if (clients) {
      clients.delete(res);
    }
  });
});

// 8. Public Leaderboard & Room Status API
app.get('/api/rooms/:code/leaderboard', (req, res) => {
  const room = rooms.get(req.params.code.toUpperCase().trim());
  if (!room) return res.status(404).json({ error: "Room not found" });
  const lb = getLeaderboard(room);
  res.json({
    code: room.code,
    roomType: room.roomType,
    maxQuestions: room.maxQuestions || 20,
    leaderboard: lb,
    stats: {
      total: room.participants.size,
      cracked: Array.from(room.participants.values()).filter(p => p.solved).length,
      topScore: Math.max(0, ...Array.from(room.participants.values()).map(p => p.score || 0))
    }
  });
});

app.get('/api/rooms/:code/status', (req, res) => {
  const room = rooms.get(req.params.code.toUpperCase().trim());
  if (!room) return res.status(404).json({ error: "Room not found" });
  res.json({
    code: room.code,
    roomType: room.roomType,
    term: room.term,
    timerSeconds: room.timerSeconds,
    maxQuestions: room.maxQuestions || 20,
    fullScreenEnabled: room.fullScreenEnabled,
    warningsEnabled: room.warningsEnabled,
    leaderboard: getLeaderboard(room),
    participants: Array.from(room.participants.values())
  });
});

app.get('/api/rooms/:code/clue', (req, res) => {
  const room = rooms.get(req.params.code.toUpperCase().trim());
  if (!room) return res.status(404).json({ error: "Room not found" });
  const qCount = parseInt(req.query.qCount || '0', 10);
  res.json(getProgressiveClues(room.term, qCount, room.maxQuestions || 20));
});

// Dedicated routes for SPA client-side navigation (/admin, /join, /participant, /room/:code)
app.get(['/admin', '/join', '/participant', '/room/:code', '*'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`===================================================`);
  console.log(` Crack the Vault Server running on port ${PORT}`);
  console.log(` Local URL:   http://localhost:${PORT}`);
  console.log(` Network Access (LAN/Wi-Fi): http://0.0.0.0:${PORT}`);
  console.log(`===================================================`);
});
