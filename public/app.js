(function() {
  const ROOM_TYPES = [
    "Programming Fundamentals",
    "Basic Languages & Tools",
    "Computer Science Basics",
    "Programming Languages",
    "UI/UX Designs",
    "Language Authors",
    "Cloud",
    "Data Structures",
    "MNC Company Details",
    "MNC Quotes"
  ];
  const MAX_QUESTIONS = 20;

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

  // Global State
  let state = {
    screen: "role", // role | admin_setup | admin_live | join | game | reveal
    roomType: "Programming Fundamentals",
    termMode: "ai", // ai | manual
    manualTerm: "",
    customNote: "",
    generatedTerm: "",
    code: "",
    name: "",
    apiKey: localStorage.getItem('participant_api_key') || "",
    joinCodeInput: "",
    history: [],
    qCount: 0,
    maxQuestions: 20,
    solved: false,
    timedOut: false,
    timerSeconds: 180,
    fullScreenEnabled: true,
    warningsEnabled: true,
    showLeaderboard: false,
    leaderboard: [],
    timerStartAt: null,
    timerInterval: null,
    finalScore: 0,
    tabSwitchWarnings: 0,
    cheatingTerminated: false,
    antiCheatArmed: false,
    lastFullscreenTransitionAt: 0,
    armTimer: null,
    adminParticipants: new Map(),
    eventSource: null,
    participantEventSource: null,
    adminPollInterval: null,
    currentClue: null
  };

  // Anti-Cheat & Warning Modal System
  function showWarningModal(title, message, buttonText, onDismiss) {
    const existing = document.getElementById('vaultWarningModal');
    if (existing) existing.remove();

    const overlay = el(`
      <div class="modal-overlay" id="vaultWarningModal">
        <div class="modal-card">
          <div style="font-size:42px; margin-bottom:8px;">⚠️</div>
          <div class="modal-title">${escapeHtml(title)}</div>
          <div class="modal-body">${escapeHtml(message)}</div>
          <button class="modal-btn" id="modalDismissBtn">${escapeHtml(buttonText)}</button>
        </div>
      </div>
    `);
    document.body.appendChild(overlay);

    overlay.querySelector('#modalDismissBtn').onclick = () => {
      overlay.remove();
      if (onDismiss) onDismiss();
    };
  }

  function disarmAntiCheatSystem() {
    if (state.armTimer) {
      clearTimeout(state.armTimer);
      state.armTimer = null;
    }
    state.antiCheatArmed = false;
    updateIntegrityBadgeUI();
  }

  function armAntiCheatSystem(delayMs = 2000) {
    if (state.armTimer) {
      clearTimeout(state.armTimer);
      state.armTimer = null;
    }
    state.antiCheatArmed = false;
    state.lastFullscreenTransitionAt = Date.now();
    updateIntegrityBadgeUI();

    state.armTimer = setTimeout(() => {
      if (state.screen === "game") {
        state.antiCheatArmed = true;
        updateIntegrityBadgeUI();
      }
    }, delayMs);
  }

  function updateIntegrityBadgeUI() {
    const badge = document.getElementById('examIntegrityBadge');
    if (!badge) return;
    if (!state.warningsEnabled) {
      badge.style.display = 'none';
      return;
    }
    badge.style.display = 'inline-flex';
    if (state.antiCheatArmed) {
      badge.className = 'integrity-badge active';
      badge.innerHTML = `<span class="dot" style="width:7px; height:7px; border-radius:50%; background:#00e676; display:inline-block; margin-right:6px; box-shadow:0 0 6px #00e676;"></span><span>🛡️ Anti-Cheat Armed</span>`;
    } else {
      badge.className = 'integrity-badge arming';
      badge.innerHTML = `<span class="dot" style="width:7px; height:7px; border-radius:50%; background:#ffb300; display:inline-block; margin-right:6px;"></span><span>⏳ Initializing Proctoring...</span>`;
    }
  }

  function requestFullScreen(onSuccess) {
    if (!state.fullScreenEnabled) {
      if (onSuccess) onSuccess();
      return;
    }
    if (document.fullscreenElement) {
      state.lastFullscreenTransitionAt = Date.now();
      armAntiCheatSystem(1500);
      if (onSuccess) onSuccess();
      return;
    }
    if (document.documentElement.requestFullscreen) {
      state.lastFullscreenTransitionAt = Date.now();
      disarmAntiCheatSystem();
      document.documentElement.requestFullscreen()
        .then(() => {
          state.lastFullscreenTransitionAt = Date.now();
          armAntiCheatSystem(2000);
          if (onSuccess) onSuccess();
        })
        .catch((err) => {
          console.log("Fullscreen request deferred to user gesture:", err);
        });
    }
  }

  function showFullscreenEntranceGate() {
    if (document.getElementById('fullscreenGateModal') || document.fullscreenElement) return;

    const overlay = el(`
      <div class="modal-overlay" id="fullscreenGateModal" style="background: rgba(4, 8, 16, 0.95); z-index: 9999;">
        <div class="modal-card gate-modal-card">
          <div style="font-size:46px; margin-bottom:12px;">🖥️</div>
          <div class="modal-title" style="color:var(--cyan); letter-spacing:1px;">FULL SCREEN EXAM MANDATE</div>
          <div class="modal-body" style="font-size:14px; line-height:1.6; color:var(--text-dim); margin-bottom:22px;">
            The host requires this exam session to be taken in Full Screen mode to ensure exam integrity. Click below to expand full screen and begin interrogating the Oracle.
          </div>
          <button class="modal-btn" id="enterFsGateBtn" style="background:var(--cyan); color:#090f1a; font-weight:700; width:100%; padding:13px 20px; cursor:pointer; font-size:13px;">
            Expand Full Screen &amp; Start Exam
          </button>
        </div>
      </div>
    `);
    document.body.appendChild(overlay);

    overlay.querySelector('#enterFsGateBtn').onclick = () => {
      state.lastFullscreenTransitionAt = Date.now();
      disarmAntiCheatSystem();
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen()
          .then(() => {
            overlay.remove();
            armAntiCheatSystem(2000);
          })
          .catch(() => {
            overlay.remove();
            armAntiCheatSystem(2000);
          });
      } else {
        overlay.remove();
        armAntiCheatSystem(2000);
      }
    };
  }

  function formatTime(totalSeconds) {
    const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  // Setup Global Anti-Cheat Event Listeners
  function initAntiCheatListeners() {
    // 1. Copy Protection ("Thambi Thappu")
    const handleCopy = (e) => {
      if (state.screen === "game" && state.warningsEnabled && state.antiCheatArmed) {
        e.preventDefault();
        showWarningModal("Thambi Thappu", "Copying content or using clipboard options is strictly prohibited during the exam!", "Understand");
      }
    };

    window.addEventListener('copy', handleCopy);
    window.addEventListener('cut', handleCopy);
    window.addEventListener('contextmenu', handleCopy);

    // 2. Tab Switch & Escape / Fullscreen Exit Violation Handler
    const handleViolation = (type) => {
      // Must be on the game screen, warnings enabled, and trigger system explicitly armed
      if (state.screen !== "game" || !state.warningsEnabled || !state.antiCheatArmed) return;

      // If violation is fullscreen exit but fullscreen enforcement is disabled by admin, ignore
      if (type === "fullscreen" && !state.fullScreenEnabled) return;

      // Ignore blur if within settling window of entering fullscreen or any modal is open
      if (type === "blur") {
        if (Date.now() - state.lastFullscreenTransitionAt < 2500) return;
        if (document.getElementById('vaultWarningModal') || document.getElementById('fullscreenGateModal')) return;
      }

      // Temporarily disarm during modal display so dismiss/re-focus doesn't double penalize
      disarmAntiCheatSystem();

      if (!state.tabSwitchWarnings) {
        state.tabSwitchWarnings = 1;
        const msg = state.fullScreenEnabled
          ? "Leaving full screen or switching tabs is strictly prohibited! This is your ONLY fair warning. If you leave full screen or switch tabs again, you will be permanently ELIMINATED and awarded 0 points regardless of your progress!"
          : "Navigating away from the exam is prohibited! This is your ONLY fair warning. If you attempt this again, you will be permanently ELIMINATED and awarded 0 points!";

        showWarningModal(
          "EXAM INTEGRITY WARNING",
          msg,
          state.fullScreenEnabled ? "Return to Fullscreen" : "Return to Exam",
          () => {
            if (state.fullScreenEnabled) {
              requestFullScreen(() => {
                armAntiCheatSystem(2000);
              });
              armAntiCheatSystem(2500);
            } else {
              armAntiCheatSystem(1500);
            }
          }
        );
      } else {
        // Second violation (After Fair Warning) -> PERMANENT ELIMINATION WITH STRICTLY 0 POINTS!
        state.cheatingTerminated = true;
        state.finalScore = 0; // 0 points no matter how close or how few questions

        // Disarm and exit fullscreen
        disarmAntiCheatSystem();
        if (state.timerInterval) {
          clearInterval(state.timerInterval);
          state.timerInterval = null;
        }
        if (document.exitFullscreen && document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }

        // Notify server of cheating / fullscreen violation
        try {
          fetch('/api/rooms/cheat-terminate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              code: state.code,
              name: state.name,
              reason: type === 'fullscreen' ? 'Left full screen after fair warning' : 'Switched tabs after fair warning'
            })
          }).catch(() => {});
        } catch (e) {}

        // Update local cache so admin leaderboard shows eliminated status immediately
        try {
          const localKey = `vault_room_participants_${state.code}`;
          let cached = JSON.parse(localStorage.getItem(localKey) || '[]');
          const pIdx = cached.findIndex(p => p.name === state.name);
          const pUpdated = {
            name: state.name,
            qCount: state.qCount,
            maxQuestions: state.maxQuestions || 20,
            score: 0,
            solved: false,
            timedOut: false,
            cheatingTerminated: true,
            isFinished: true,
            status: "Eliminated",
            statusDetail: "Eliminated (Fullscreen Exit)"
          };
          if (pIdx >= 0) cached[pIdx] = Object.assign(cached[pIdx], pUpdated);
          else cached.push(pUpdated);
          localStorage.setItem(localKey, JSON.stringify(cached));
        } catch (err) {}

        state.screen = "reveal";
        render();
      }
    };

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && state.screen === "game" && state.antiCheatArmed) {
        handleViolation("tab");
      }
    });

    document.addEventListener('fullscreenchange', () => {
      if (state.screen === "game" && state.fullScreenEnabled) {
        if (!document.fullscreenElement) {
          if (state.antiCheatArmed) {
            handleViolation("fullscreen");
          }
        } else {
          // Just entered fullscreen!
          state.lastFullscreenTransitionAt = Date.now();
          const gate = document.getElementById('fullscreenGateModal');
          if (gate) gate.remove();
        }
      }
    });

    window.addEventListener('blur', () => {
      if (state.screen === "game" && state.antiCheatArmed) {
        handleViolation("blur");
      }
    });

    window.addEventListener('keydown', (e) => {
      if (state.screen === "game" && state.warningsEnabled && (e.key === "Escape" || (e.altKey && e.key === "Tab"))) {
        if (state.antiCheatArmed) {
          e.preventDefault();
          handleViolation("escape");
        }
      }
    });

    // Cross-tab synchronization for offline/standalone testing
    window.addEventListener('storage', (e) => {
      if (state.code && e.key === `vault_room_${state.code}` && e.newValue) {
        try {
          const updated = JSON.parse(e.newValue);
          let changed = false;
          if (updated.fullScreenEnabled !== undefined && updated.fullScreenEnabled !== state.fullScreenEnabled) {
            state.fullScreenEnabled = updated.fullScreenEnabled;
            changed = true;
          }
          if (updated.warningsEnabled !== undefined && updated.warningsEnabled !== state.warningsEnabled) {
            state.warningsEnabled = updated.warningsEnabled;
            changed = true;
          }
          if (updated.showLeaderboard !== undefined && updated.showLeaderboard !== state.showLeaderboard) {
            state.showLeaderboard = updated.showLeaderboard;
            changed = true;
          }
          if (updated.timerSeconds !== undefined && updated.timerSeconds !== state.timerSeconds) {
            state.timerSeconds = updated.timerSeconds;
            changed = true;
          }
          if (changed) render();
        } catch (err) {}
      }
    });
  }

  initAntiCheatListeners();

  // URL Route Parser (/admin, /join, /participant, ?code=XXXXX)
  function parseUrlRoute() {
    const path = window.location.pathname.toLowerCase();
    const params = new URLSearchParams(window.location.search);
    const codeParam = params.get('code') || params.get('room');

    if (codeParam) {
      state.joinCodeInput = codeParam.toUpperCase().trim();
    }

    const roomMatch = path.match(/\/room\/([a-z0-9]+)/i);
    if (roomMatch) {
      state.joinCodeInput = roomMatch[1].toUpperCase().trim();
    }

    if (path.startsWith('/admin')) {
      state.screen = "admin_setup";
    } else if (path.startsWith('/join') || path.startsWith('/participant') || path.startsWith('/room')) {
      state.screen = "join";
    }
  }

  // Pre-seeded fallback term banks for offline execution
  const FALLBACK_BANKS = {
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
    "Programming Languages": ["Python", "JavaScript", "Rust", "TypeScript", "C++", "Go", "Java", "Kotlin", "Swift", "Haskell"],
    "UI/UX Designs": ["Wireframe", "Glassmorphism", "Design System", "Typography", "Micro-interaction", "User Journey Map", "Figma", "Color Palette", "Responsive Layout", "Accessibility (a11y)"],
    "Language Authors": ["Guido van Rossum", "Brendan Eich", "Dennis Ritchie", "Bjarne Stroustrup", "James Gosling", "Rob Pike", "Graydon Hoare", "Anders Hejlsberg", "Larry Wall", "Yukihiro Matsumoto"],
    "Cloud": ["Kubernetes", "Docker", "Amazon S3", "Serverless", "AWS Lambda", "Microservices", "Terraform", "Load Balancer", "Cloudflare", "IAM Policy"],
    "Data Structures": ["Linked List", "Binary Tree", "Hash Table", "Stack", "Queue", "Graph", "Heap", "Trie", "Red-Black Tree", "B-Tree"],
    "MNC Company Details": ["Google", "Microsoft", "Apple", "Amazon", "Meta", "NVIDIA", "Netflix", "Intel", "IBM", "Oracle"],
    "MNC Quotes": ["Move Fast and Break Things", "Stay Hungry, Stay Foolish", "Organize the World's Information", "Don't Be Evil", "Think Different", "Customer Obsession", "Embrace and Extend", "Work Hard, Have Fun, Make History", "Connecting People", "Move Fast with Stable Infrastructure"]
  };

  // Helper Functions
  function el(html) {
    const d = document.createElement('div');
    d.innerHTML = html.trim();
    return d.firstChild;
  }

  function escapeHtml(s) {
    if (!s) return "";
    return String(s).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  }

  function badgeFor(text) {
    if (!text) return "other";
    const t = text.toLowerCase().trim();
    if (t.startsWith("yes") || t.startsWith("correct")) return "yes";
    if (t.startsWith("no") && !t.includes("not correct")) return "no";
    if (t.startsWith("maybe")) return "maybe";
    if (t.startsWith("invalid") || t.startsWith("irrelevant")) return "other";
    return "other";
  }

  function oracleAnswerHtml(text) {
    const cls = badgeFor(text);
    const lower = text.toLowerCase();
    let icon = '—';
    let label = text.trim();
    let detail = '';

    if (cls === 'yes') {
      icon = '✓';
      label = 'YES';
    } else if (cls === 'no') {
      icon = '✗';
      label = 'NO';
    } else if (lower.startsWith('correct!')) {
      icon = '✓';
      label = 'CORRECT';
      detail = text.substring(text.indexOf('!') + 1).trim();
    } else {
      icon = '—';
      const firstBreak = text.search(/[.,!]/);
      label = firstBreak > 0 ? text.substring(0, firstBreak).trim().toUpperCase() : text.toUpperCase();
      detail = firstBreak > 0 ? text.substring(firstBreak + 1).trim() : '';
    }

    if (!detail && cls === 'other') {
      const firstWord = label.split(' ')[0];
      if (firstWord && firstWord !== label) {
        detail = label.substring(firstWord.length).trim();
        label = firstWord;
      }
    }

    return `<div class="oracle-answer ${cls}"><span class="icon">${icon}</span>${escapeHtml(label)}${detail ? '<div class="oracle-detail">' + escapeHtml(detail) + '</div>' : ''}</div>`;
  }

  // Progressive Word Clues Generator (Scales adaptively to maxQuestions)
  function getProgressiveClues(term, qCount, maxQuestions = 20) {
    const maxQ = Math.max(3, Number(maxQuestions || state.maxQuestions) || 20);
    const lvl1 = Math.max(2, Math.floor(maxQ * 0.5));
    const lvl2 = Math.max(lvl1 + 1, Math.floor(maxQ * 0.7));
    const lvl3 = Math.max(lvl2 + 1, Math.floor(maxQ * 0.85));

    if (!term || qCount < lvl1) {
      return {
        unlocked: false,
        level: 0,
        qCount: qCount || 0,
        needed: Math.max(0, lvl1 - (qCount || 0)),
        clue: "",
        desc: "",
        conceptHint: "",
        lvl1Threshold: lvl1,
        lvl2Threshold: lvl2,
        lvl3Threshold: lvl3,
        message: `Progressive word clues unlock after ${lvl1} questions (${Math.max(0, lvl1 - (qCount || 0))} question${Math.max(0, lvl1 - (qCount || 0)) === 1 ? '' : 's'} remaining).`
      };
    }

    const words = term.trim().split(/\s+/);
    let level = 1;
    let clue = "";
    let desc = "";

    if (qCount >= lvl3) {
      level = 3;
      desc = "Level 3 Clue: Vowels & Boundary Letters Revealed + Concept Nudge";
      const vowels = new Set(['a', 'e', 'i', 'o', 'u', 'A', 'E', 'I', 'O', 'U']);
      clue = words.map(w => {
        return w.split('').map((ch, idx) => {
          if (/[^a-zA-Z0-9]/.test(ch)) return ch;
          if (idx === 0 || idx === w.length - 1 || vowels.has(ch)) return ch;
          return '_';
        }).join(' ');
      }).join('   ');
    } else if (qCount >= lvl2) {
      level = 2;
      desc = "Level 2 Clue: First & Last Boundary Letters Revealed";
      clue = words.map(w => {
        return w.split('').map((ch, idx) => {
          if (/[^a-zA-Z0-9]/.test(ch)) return ch;
          if (idx === 0 || idx === w.length - 1) return ch;
          return '_';
        }).join(' ');
      }).join('   ');
    } else {
      level = 1;
      desc = "Level 1 Clue: Word Structure & Character Counts";
      clue = words.map(w => {
        return w.split('').map(ch => {
          if (/[^a-zA-Z0-9]/.test(ch)) return ch;
          return '_';
        }).join(' ');
      }).join('   ');
    }

    const wordLengths = words.map(w => `${w.replace(/[^a-zA-Z0-9]/g, '').length} letters`).join(', ');

    return {
      unlocked: true,
      level,
      qCount,
      clue,
      desc: `${desc} (${wordLengths})`,
      lvl1Threshold: lvl1,
      lvl2Threshold: lvl2,
      lvl3Threshold: lvl3,
      message: `Progressive word clue active (Level ${level})`
    };
  }

  function updateClueUI(clueData) {
    const container = document.getElementById('clueContainer');
    if (!container) return;

    const clue = clueData || state.currentClue || getProgressiveClues(state.generatedTerm, state.qCount, state.maxQuestions);
    state.currentClue = clue;

    if (!clue || !clue.unlocked) {
      const unlockAt = clue?.lvl1Threshold || Math.floor((state.maxQuestions || 20) * 0.5);
      const needed = clue ? clue.needed : Math.max(1, unlockAt - state.qCount);
      container.innerHTML = `
        <div class="clue-box locked">
          <div class="clue-header">
            <span class="clue-title">🔒 Progressive Word Clues</span>
            <span class="clue-tag lvl-1">Unlocks at Q${unlockAt}</span>
          </div>
          <div class="clue-desc">
            Ask sharp questions! Progressive structural &amp; letter clues unlock if you reach ${unlockAt} questions (${needed} more question${needed === 1 ? '' : 's'} to unlock).
          </div>
        </div>
      `;
      return;
    }

    const patternText = clue.pattern || clue.clue || '';
    const descText = clue.hint || clue.desc || '';
    const lvlClass = clue.level === 3 ? 'lvl-3' : (clue.level === 2 ? 'lvl-2' : 'lvl-1');
    container.innerHTML = `
      <div class="clue-box unlocked">
        <div class="clue-header">
          <span class="clue-title">💡 Progressive Word Clue Unlocked</span>
          <span class="clue-tag ${lvlClass}">Level ${clue.level} of 3</span>
        </div>
        <div class="clue-pattern">${escapeHtml(patternText)}</div>
        <div class="clue-desc">${escapeHtml(descText)}</div>
        ${clue.conceptHint ? `<div class="clue-desc" style="color:var(--cyan); margin-top:5px; font-style:italic;"><strong>Oracle Nudge:</strong> ${escapeHtml(clue.conceptHint)}</div>` : ''}
      </div>
    `;
  }

  function genCode() {
    const chars = "ACDEFGHJKLMNPQRSTUVWXYZ23456789";
    let c = "";
    for (let i = 0; i < 5; i++) c += chars[Math.floor(Math.random() * chars.length)];
    return c;
  }

  function header(wrap, eyebrow, title, sub) {
    wrap.appendChild(el(`
      <div class="eyebrow"><span class="dot"></span>${escapeHtml(eyebrow)}</div>
      <h1>${escapeHtml(title)}</h1>
      <div class="sub">${escapeHtml(sub)}</div>
    `));
  }

  // Master Render Engine
  function render() {
    const app = document.getElementById('app');
    app.innerHTML = "";
    
    const isWide = state.screen === "admin_live";
    const wrap = el(`<div class="wrap ${isWide ? 'wide' : ''}"></div>`);
    app.appendChild(wrap);

    switch(state.screen) {
      case "role":
        renderRole(wrap);
        break;
      case "admin_setup":
        renderAdminSetup(wrap);
        break;
      case "admin_live":
        renderAdminLive(wrap);
        break;
      case "join":
        renderJoin(wrap);
        break;
      case "game":
        renderGame(wrap);
        break;
      case "reveal":
        renderReveal(wrap);
        break;
    }
  }

  // 1. Role Selection Screen
  function renderRole(wrap) {
    header(wrap, "CSE DEPT · PRIVATE VAULT", "Crack the Vault", "An AI Oracle is holding a secret technical term across core computer science domains. Ask narrow questions about properties & behavior, analyze small hints, and crack the vault before running out of moves.");

    const grid = el(`<div class="role-grid"></div>`);
    const adminCard = el(`
      <div class="role-card" id="pickAdmin">
        <div class="card-tag">Host Console</div>
        <h3>Admin</h3>
        <p>Create a vault session, choose a CS category, select AI or manual custom secret terms, and monitor participant attempts live in real time.</p>
      </div>`);
    const partCard = el(`
      <div class="role-card" id="pickJoin">
        <div class="card-tag">Interrogate Vault</div>
        <h3>Participant</h3>
        <p>Join a private vault room code. Question the AI Oracle in complete isolation — no leaderboards, pure tactical problem solving.</p>
      </div>`);

    grid.appendChild(adminCard);
    grid.appendChild(partCard);
    wrap.appendChild(grid);

    adminCard.onclick = () => {
      state.screen = "admin_setup";
      render();
    };

    partCard.onclick = () => {
      state.screen = "join";
      render();
    };
  }

  // 2. Admin Setup Screen (Room Types, Terms, Time Allotment & Participant Controls)
  function renderAdminSetup(wrap) {
    const backBtn = el(`<span class="backlink">&larr; back to role selection</span>`);
    backBtn.onclick = () => { state.screen = "role"; render(); };
    wrap.appendChild(backBtn);

    // Leaderboard Persistence: If an active vault session exists, show resume card so admin never loses track
    const savedActive = localStorage.getItem('vault_admin_active_room');
    if (savedActive) {
      try {
        const activeData = JSON.parse(savedActive);
        if (activeData && activeData.code) {
          const activeCard = el(`
            <div class="active-room-card">
              <div class="active-room-info">
                <div class="active-room-lbl">
                  <span class="status-dot" style="width:7px; height:7px; border-radius:50%; background:var(--accent); display:inline-block; box-shadow:0 0 8px var(--accent);"></span>
                  ACTIVE VAULT SESSION IN PROGRESS
                </div>
                <div class="active-room-code">
                  Room Code: <strong style="font-family:var(--mono); color:var(--cyan); letter-spacing:0.1em;">${escapeHtml(activeData.code)}</strong> · ${escapeHtml(activeData.roomType || 'CS Vault')}
                </div>
                <div class="hint" style="margin:2px 0 0 0; color:var(--text-dim);">
                  Candidate telemetry and marks are running live. Resume anytime without losing participant data.
                </div>
              </div>
              <div class="row" style="gap:8px;">
                <button id="resumeActiveRoomBtn">▶ Resume Live Leaderboard</button>
                <button class="ghost small" id="discardActiveRoomBtn">Dismiss</button>
              </div>
            </div>
          `);
          wrap.appendChild(activeCard);

          activeCard.querySelector('#resumeActiveRoomBtn').onclick = () => {
            state.code = activeData.code;
            state.roomType = activeData.roomType || state.roomType;
            state.generatedTerm = activeData.generatedTerm || "";
            state.timerSeconds = activeData.timerSeconds || state.timerSeconds;
            state.fullScreenEnabled = activeData.fullScreenEnabled !== undefined ? activeData.fullScreenEnabled : state.fullScreenEnabled;
            state.warningsEnabled = activeData.warningsEnabled !== undefined ? activeData.warningsEnabled : state.warningsEnabled;
            state.screen = "admin_live";
            render();
          };

          activeCard.querySelector('#discardActiveRoomBtn').onclick = () => {
            localStorage.removeItem('vault_admin_active_room');
            activeCard.remove();
          };
        }
      } catch (err) {}
    }

    header(wrap, "ADMIN CONSOLE", "Set Up Vault Session", "Select a Computer Science topic domain, configure exam time duration, and set participant page access policies.");

    const panel = el(`
      <div class="panel">
        <label>1. Select Room Type Category</label>
        <div class="type-grid" id="typeGrid"></div>

        <label style="margin-top:20px;">2. Secret Term Source</label>
        <div class="row" style="margin-bottom:14px;">
          <button class="${state.termMode === 'ai' ? '' : 'ghost'}" id="modeAi">AI Generated Term</button>
          <button class="${state.termMode === 'manual' ? '' : 'ghost'}" id="modeManual">Manual Custom Term</button>
        </div>

        <div id="termConfigArea"></div>

        <label style="margin-top:16px;">Optional Host Context Note / Rule</label>
        <input type="text" id="customNote" placeholder="e.g. Focus specifically on network transport protocols" value="${escapeHtml(state.customNote)}" />

        <label style="margin-top:22px;">3. Exam Duration Allotment</label>
        <div class="preset-chips" id="presetChips">
          <button type="button" class="preset-chip ${state.timerSeconds === 60 ? 'active' : ''}" data-sec="60">1 Min (60s)</button>
          <button type="button" class="preset-chip ${state.timerSeconds === 180 ? 'active' : ''}" data-sec="180">3 Mins (180s)</button>
          <button type="button" class="preset-chip ${state.timerSeconds === 300 ? 'active' : ''}" data-sec="300">5 Mins (300s)</button>
          <button type="button" class="preset-chip ${state.timerSeconds === 600 ? 'active' : ''}" data-sec="600">10 Mins (600s)</button>
          <button type="button" class="preset-chip ${state.timerSeconds === 900 ? 'active' : ''}" data-sec="900">15 Mins (900s)</button>
          <button type="button" class="preset-chip ${state.timerSeconds === 1800 ? 'active' : ''}" data-sec="1800">30 Mins (1800s)</button>
        </div>
        <div class="row" style="align-items:center;">
          <div style="flex:1; max-width:260px;">
            <input type="number" id="timerSeconds" min="10" max="3600" value="${state.timerSeconds}" />
          </div>
          <div class="hint" style="margin:0;">Exam auto-submits &amp; exits participant screen when this allotted duration expires.</div>
        </div>

        <label style="margin-top:22px;">4. Oracle Question Allowance per Participant</label>
        <div class="preset-chips" id="maxQChips">
          <button type="button" class="preset-chip ${state.maxQuestions === 5 ? 'active' : ''}" data-q="5">5 Qs</button>
          <button type="button" class="preset-chip ${state.maxQuestions === 10 ? 'active' : ''}" data-q="10">10 Qs</button>
          <button type="button" class="preset-chip ${state.maxQuestions === 15 ? 'active' : ''}" data-q="15">15 Qs</button>
          <button type="button" class="preset-chip ${state.maxQuestions === 20 ? 'active' : ''}" data-q="20">20 Qs (Default)</button>
          <button type="button" class="preset-chip ${state.maxQuestions === 25 ? 'active' : ''}" data-q="25">25 Qs</button>
          <button type="button" class="preset-chip ${state.maxQuestions === 30 ? 'active' : ''}" data-q="30">30 Qs</button>
        </div>
        <div class="row" style="align-items:center;">
          <div style="flex:1; max-width:260px;">
            <input type="number" id="maxQuestionsInput" min="3" max="100" value="${state.maxQuestions}" />
          </div>
          <div class="hint" style="margin:0;">Maximum AI questions each student can ask. Participant inputs lock once reached.</div>
        </div>

        <label style="margin-top:24px;">5. Participant Page Controls &amp; Policies</label>
        <div class="controls-grid">
          <div class="toggle-card ${state.fullScreenEnabled ? 'active' : ''}" id="cardFs">
            <div class="toggle-header">
              <span class="toggle-title">🖥️ Full Screen</span>
              <label class="switch">
                <input type="checkbox" id="toggleFullScreen" ${state.fullScreenEnabled ? 'checked' : ''} />
                <span class="slider"></span>
              </label>
            </div>
            <div class="toggle-desc">Enforces full screen mode when participants enter the interrogation vault.</div>
            <div class="toggle-status ${state.fullScreenEnabled ? 'on' : 'off'}">${state.fullScreenEnabled ? '● Fullscreen Enforced' : '○ Windowed Allowed'}</div>
          </div>

          <div class="toggle-card ${state.warningsEnabled ? 'active' : ''}" id="cardWarn">
            <div class="toggle-header">
              <span class="toggle-title">⚠️ Anti-Cheat Warnings</span>
              <label class="switch">
                <input type="checkbox" id="toggleWarnings" ${state.warningsEnabled ? 'checked' : ''} />
                <span class="slider"></span>
              </label>
            </div>
            <div class="toggle-desc">Intercepts copy/clipboard actions ("Thambi Thappu") and warns/submits on tab-switch &amp; Escape.</div>
            <div class="toggle-status ${state.warningsEnabled ? 'on' : 'off'}">${state.warningsEnabled ? '● Warnings Active' : '○ Warnings Disabled'}</div>
          </div>
        </div>

        <div class="row" style="margin-top:28px; justify-content:flex-end;">
          <button id="createRoomBtn">Generate Secret &amp; Launch Room</button>
        </div>
        <div class="error-msg" id="setupErr" style="display:none;"></div>

        <div class="row" style="margin-top:24px; padding-top:16px; border-top:1px solid var(--grid-line); justify-content:space-between; align-items:center;">
          <span style="font-size:12px; color:var(--text-dim); font-family:var(--mono);">Or monitor an existing vault room code:</span>
          <div class="row" style="gap:8px;">
            <input type="text" id="resumeCodeInput" placeholder="ROOM CODE" style="width:130px; text-transform:uppercase; font-size:12px; padding:6px 10px;" />
            <button class="ghost small" id="resumeCodeBtn">Open Live Monitor</button>
          </div>
        </div>
      </div>
    `);
    wrap.appendChild(panel);

    const resumeCodeBtn = panel.querySelector('#resumeCodeBtn');
    if (resumeCodeBtn) {
      resumeCodeBtn.onclick = () => {
        const code = (panel.querySelector('#resumeCodeInput').value || '').trim().toUpperCase();
        if (!code) return;
        state.code = code;
        state.screen = "admin_live";
        render();
      };
    }

    // Render Room Type Cards
    const typeGrid = panel.querySelector('#typeGrid');
    ROOM_TYPES.forEach(t => {
      const card = el(`
        <div class="type-card ${state.roomType === t ? 'selected' : ''}">
          <div class="card-tag">Domain</div>
          <h3>${escapeHtml(t)}</h3>
        </div>
      `);
      card.onclick = () => {
        const mVal = panel.querySelector('#manualTermInput')?.value;
        if (mVal !== undefined) state.manualTerm = mVal;
        const noteVal = panel.querySelector('#customNote')?.value;
        if (noteVal !== undefined) state.customNote = noteVal;
        state.roomType = t;
        render();
      };
      typeGrid.appendChild(card);
    });

    const termConfigArea = panel.querySelector('#termConfigArea');
    if (state.termMode === 'ai') {
      termConfigArea.innerHTML = `
        <div class="hint">The Oracle will automatically generate a secret technical term from <strong>${escapeHtml(state.roomType)}</strong> when the room launches.</div>
      `;
    } else {
      termConfigArea.innerHTML = `
        <label>Enter Secret Technical Term</label>
        <input type="text" id="manualTermInput" placeholder="e.g. Bellman-Ford Algorithm" value="${escapeHtml(state.manualTerm)}" />
      `;
    }

    panel.querySelector('#modeAi').onclick = () => {
      const mVal = panel.querySelector('#manualTermInput')?.value;
      if (mVal !== undefined) state.manualTerm = mVal;
      const noteVal = panel.querySelector('#customNote')?.value;
      if (noteVal !== undefined) state.customNote = noteVal;
      state.termMode = 'ai';
      render();
    };
    panel.querySelector('#modeManual').onclick = () => {
      const mVal = panel.querySelector('#manualTermInput')?.value;
      if (mVal !== undefined) state.manualTerm = mVal;
      const noteVal = panel.querySelector('#customNote')?.value;
      if (noteVal !== undefined) state.customNote = noteVal;
      state.termMode = 'manual';
      render();
    };

    // Timer preset chip clicks
    panel.querySelectorAll('#presetChips .preset-chip').forEach(btn => {
      btn.onclick = () => {
        const sec = parseInt(btn.getAttribute('data-sec'), 10);
        state.timerSeconds = sec;
        const input = panel.querySelector('#timerSeconds');
        if (input) input.value = sec;
        panel.querySelectorAll('#presetChips .preset-chip').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      };
    });

    panel.querySelector('#timerSeconds').oninput = (e) => {
      const v = parseInt(e.target.value, 10);
      if (!isNaN(v) && v > 0) {
        state.timerSeconds = v;
        panel.querySelectorAll('#presetChips .preset-chip').forEach(b => {
          b.classList.toggle('active', parseInt(b.getAttribute('data-sec'), 10) === v);
        });
      }
    };

    // Question limit preset clicks
    panel.querySelectorAll('#maxQChips .preset-chip').forEach(btn => {
      btn.onclick = () => {
        const q = parseInt(btn.getAttribute('data-q'), 10);
        state.maxQuestions = q;
        const input = panel.querySelector('#maxQuestionsInput');
        if (input) input.value = q;
        panel.querySelectorAll('#maxQChips .preset-chip').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      };
    });

    panel.querySelector('#maxQuestionsInput').oninput = (e) => {
      const v = parseInt(e.target.value, 10);
      if (!isNaN(v) && v > 0) {
        state.maxQuestions = Math.max(3, Math.min(100, v));
        panel.querySelectorAll('#maxQChips .preset-chip').forEach(b => {
          b.classList.toggle('active', parseInt(b.getAttribute('data-q'), 10) === v);
        });
      }
    };

    // Toggle event handlers
    const toggleFs = panel.querySelector('#toggleFullScreen');
    toggleFs.onchange = (e) => {
      state.fullScreenEnabled = e.target.checked;
      panel.querySelector('#cardFs').classList.toggle('active', state.fullScreenEnabled);
      panel.querySelector('#cardFs .toggle-status').className = `toggle-status ${state.fullScreenEnabled ? 'on' : 'off'}`;
      panel.querySelector('#cardFs .toggle-status').textContent = state.fullScreenEnabled ? '● Fullscreen Enforced' : '○ Windowed Allowed';
    };

    const toggleWarn = panel.querySelector('#toggleWarnings');
    toggleWarn.onchange = (e) => {
      state.warningsEnabled = e.target.checked;
      panel.querySelector('#cardWarn').classList.toggle('active', state.warningsEnabled);
      panel.querySelector('#cardWarn .toggle-status').className = `toggle-status ${state.warningsEnabled ? 'on' : 'off'}`;
      panel.querySelector('#cardWarn .toggle-status').textContent = state.warningsEnabled ? '● Warnings Active' : '○ Warnings Disabled';
    };

    panel.querySelector('#createRoomBtn').onclick = async () => {
      const errBox = panel.querySelector('#setupErr');
      errBox.style.display = "none";

      const customNoteVal = panel.querySelector('#customNote').value.trim();
      const timerSecondsVal = parseInt(panel.querySelector('#timerSeconds').value, 10) || state.timerSeconds;
      const maxQuestionsVal = parseInt(panel.querySelector('#maxQuestionsInput')?.value, 10) || state.maxQuestions;
      state.customNote = customNoteVal;
      state.timerSeconds = Math.max(10, Math.min(3600, timerSecondsVal));
      state.maxQuestions = Math.max(3, Math.min(100, maxQuestionsVal));

      let termToUse = "";
      if (state.termMode === 'manual') {
        const mVal = panel.querySelector('#manualTermInput')?.value.trim();
        if (!mVal) {
          errBox.style.display = "block";
          errBox.textContent = "Please enter a manual secret term.";
          return;
        }
        termToUse = mVal;
      }

      try {
        const resp = await fetch('/api/rooms/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomType: state.roomType,
            termMode: state.termMode,
            manualTerm: termToUse,
            customNote: state.customNote,
            timerSeconds: state.timerSeconds,
            maxQuestions: state.maxQuestions,
            fullScreenEnabled: state.fullScreenEnabled,
            warningsEnabled: state.warningsEnabled,
            showLeaderboard: state.showLeaderboard
          })
        });

        if (resp.ok) {
          const data = await resp.json();
          state.code = data.code;
          state.generatedTerm = data.term;
          state.fullScreenEnabled = data.fullScreenEnabled;
          state.warningsEnabled = data.warningsEnabled;
          state.showLeaderboard = data.showLeaderboard;
          state.timerSeconds = data.timerSeconds;
          state.maxQuestions = data.maxQuestions || state.maxQuestions;
        } else {
          throw new Error("Server error");
        }
      } catch (e) {
        // Standalone offline fallback
        state.code = genCode();
        if (state.termMode === 'manual') {
          state.generatedTerm = termToUse;
        } else {
          const pool = FALLBACK_BANKS[state.roomType] || FALLBACK_BANKS["Programming Languages"];
          state.generatedTerm = pool[Math.floor(Math.random() * pool.length)];
        }
        // Save room locally for offline participant testing
        localStorage.setItem(`vault_room_${state.code}`, JSON.stringify({
          code: state.code,
          roomType: state.roomType,
          term: state.generatedTerm,
          customNote: state.customNote,
          timerSeconds: state.timerSeconds,
          fullScreenEnabled: state.fullScreenEnabled,
          warningsEnabled: state.warningsEnabled,
          showLeaderboard: state.showLeaderboard
        }));
      }

      localStorage.setItem('vault_admin_active_room', JSON.stringify({
        code: state.code,
        roomType: state.roomType,
        generatedTerm: state.generatedTerm,
        timerSeconds: state.timerSeconds,
        fullScreenEnabled: state.fullScreenEnabled,
        warningsEnabled: state.warningsEnabled
      }));

      state.screen = "admin_live";
      render();
    };
  }

  // Helper for admin live settings updates
  async function sendAdminSettingsUpdate(updates, panel) {
    Object.assign(state, updates);

    // Save to local storage for offline cross-tab sync
    const localKey = `vault_room_${state.code}`;
    const localData = localStorage.getItem(localKey);
    if (localData) {
      try {
        const parsed = JSON.parse(localData);
        Object.assign(parsed, updates);
        localStorage.setItem(localKey, JSON.stringify(parsed));
      } catch (err) {}
    }

    try {
      await fetch(`/api/rooms/${state.code}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });
    } catch (e) {
      console.log("Offline mode: settings updated locally");
    }

    if (panel) updateHostControlsToolbar(panel);
  }

  function updateHostControlsToolbar(panel) {
    const fsBtn = panel.querySelector('#liveToggleFs');
    if (fsBtn) {
      fsBtn.className = `action-toggle-btn ${state.fullScreenEnabled ? 'active' : ''}`;
      fsBtn.innerHTML = `<span class="state-dot"></span>🖥️ Full Screen: <strong>${state.fullScreenEnabled ? 'Enforced' : 'Disabled'}</strong>`;
    }

    const warnBtn = panel.querySelector('#liveToggleWarn');
    if (warnBtn) {
      warnBtn.className = `action-toggle-btn ${state.warningsEnabled ? 'active' : ''}`;
      warnBtn.innerHTML = `<span class="state-dot"></span>⚠️ Warning Lock: <strong>${state.warningsEnabled ? 'Active' : 'Disabled'}</strong>`;
    }
    const timeDisplay = panel.querySelector('#liveAllottedTimeDisplay');
    if (timeDisplay) {
      timeDisplay.textContent = formatTime(state.timerSeconds);
    }
    const maxQDisplay = panel.querySelector('#liveMaxQDisplay');
    if (maxQDisplay) {
      maxQDisplay.textContent = `${state.maxQuestions || 20} Qs`;
    }
  }

  // 3. Admin Live Telemetry Monitor
  function renderAdminLive(wrap) {
    if (window.location.pathname !== '/admin') {
      window.history.pushState({}, '', '/admin');
    }

    if (state.adminPollInterval) {
      clearInterval(state.adminPollInterval);
      state.adminPollInterval = null;
    }

    // Persist active room info so admin can navigate away and return anytime
    localStorage.setItem('vault_admin_active_room', JSON.stringify({
      code: state.code,
      roomType: state.roomType,
      generatedTerm: state.generatedTerm,
      timerSeconds: state.timerSeconds,
      maxQuestions: state.maxQuestions,
      fullScreenEnabled: state.fullScreenEnabled,
      warningsEnabled: state.warningsEnabled
    }));

    // Restore cached participants from previous sessions if available
    const cachedParts = localStorage.getItem(`vault_room_participants_${state.code}`);
    if (cachedParts) {
      try {
        const list = JSON.parse(cachedParts);
        if (Array.isArray(list)) {
          list.forEach(p => state.adminParticipants.set(p.name, p));
        }
      } catch (e) {}
    }

    const backBtn = el(`<span class="backlink">&larr; Back to Setup</span>`);
    backBtn.onclick = () => {
      if (state.adminPollInterval) {
        clearInterval(state.adminPollInterval);
        state.adminPollInterval = null;
      }
      if (state.eventSource) state.eventSource.close();
      state.screen = "admin_setup";
      render();
    };
    wrap.appendChild(backBtn);

    header(wrap, "LIVE MONITOR CONSOLE", `Vault Room: ${state.code}`, `Domain: ${state.roomType} · Secret Term: ${state.generatedTerm}`);

    const joinUrl = `${window.location.protocol}//${window.location.host}/join?code=${state.code}`;

    const panel = el(`
      <div class="panel">
        <div class="row" style="justify-content:space-between; align-items:flex-start;">
          <div style="flex:1;">
            <label style="margin:0;">Room Code — Share with Participants</label>
            <div class="code-display" style="padding:10px 24px; margin:8px 0; display:inline-block;">${escapeHtml(state.code)}</div>
            <div class="hint">Secret term (hidden from players): <strong style="color:var(--cyan);">${escapeHtml(state.generatedTerm)}</strong></div>
            
            <label style="margin-top:14px;">Direct Participant Join Link</label>
            <div class="row">
              <input type="text" value="${escapeHtml(joinUrl)}" readonly id="joinUrlInput" style="font-size:13px; flex:1;" />
              <button class="ghost small" id="copyUrlBtn">Copy Participant Link</button>
            </div>
          </div>
          <button class="ghost small" id="newRoomBtn" style="margin-top:16px;">Create New Room</button>
        </div>

        <!-- Real-Time Host Exam Controls Toolbar -->
        <div class="host-controls-panel">
          <div class="host-controls-title">
            <span>⚡ Host Exam Controls (Real-Time Participant Overrides)</span>
            <span style="color:var(--text-dim); font-size:10.5px;">Instant SSE Sync</span>
          </div>
          <div class="host-actions-row">
            <button class="action-toggle-btn ${state.fullScreenEnabled ? 'active' : ''}" id="liveToggleFs">
              <span class="state-dot"></span>
              🖥️ Full Screen: <strong>${state.fullScreenEnabled ? 'Enforced' : 'Disabled'}</strong>
            </button>
            <button class="action-toggle-btn ${state.warningsEnabled ? 'active' : ''}" id="liveToggleWarn">
              <span class="state-dot"></span>
              ⚠️ Warning Lock: <strong>${state.warningsEnabled ? 'Active' : 'Disabled'}</strong>
            </button>
            <div class="extend-time-group">
              <span>Allotted: <strong style="color:var(--accent);" id="liveAllottedTimeDisplay">${formatTime(state.timerSeconds)}</strong></span>
              <button class="ghost small" id="add1mBtn" title="Allot +1 minute to participants">+1m</button>
              <button class="ghost small" id="add2mBtn" title="Allot +2 minutes to participants">+2m</button>
              <button class="ghost small" id="add5mBtn" title="Allot +5 minutes to participants">+5m</button>
            </div>
            <div class="extend-time-group">
              <span>Questions: <strong style="color:var(--cyan);" id="liveMaxQDisplay">${state.maxQuestions || 20} Qs</strong></span>
              <button class="ghost small" id="sub5qBtn" title="Reduce question limit by 5">-5 Qs</button>
              <button class="ghost small" id="add5qBtn" title="Increase question limit by 5">+5 Qs</button>
            </div>
          </div>
        </div>

        <!-- Dedicated Real-Time Leaderboard for Admin Console -->
        <div style="margin-top:22px; border-top:1px solid var(--grid-line); padding-top:18px;">
          <div class="row" style="justify-content:space-between; align-items:center; margin-bottom:12px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:18px;">🏆</span>
              <label style="margin:0; font-size:13px; font-weight:700; color:var(--text); letter-spacing:0.06em; text-transform:uppercase;">Live Candidate Leaderboard (Admin Console)</label>
            </div>
            <button class="ghost small" id="adminRefreshLbBtn">Refresh Leaderboard</button>
          </div>

          <div class="admin-stats-bar">
            <div class="admin-stat-card">
              <div class="admin-stat-num" id="adminStatJoined">0</div>
              <div class="admin-stat-lbl">Participants Joined</div>
            </div>
            <div class="admin-stat-card">
              <div class="admin-stat-num" id="adminStatCracked" style="color:var(--emerald);">0</div>
              <div class="admin-stat-lbl">Vaults Cracked</div>
            </div>
            <div class="admin-stat-card">
              <div class="admin-stat-num" id="adminStatTopScore" style="color:var(--accent);">0</div>
              <div class="admin-stat-lbl">Top Score</div>
            </div>
          </div>

          <div class="leaderboard-panel" style="margin-top:10px;">
            <table class="lb-table" id="adminLbTable">
              <thead>
                <tr>
                  <th style="width:48px;">Rank</th>
                  <th>Callsign / Participant</th>
                  <th>Status</th>
                  <th>Questions</th>
                  <th style="text-align:right;">Marks / Score</th>
                </tr>
              </thead>
              <tbody id="adminLbBody">
                <tr><td colspan="5" class="loading">Waiting for participants to join and log telemetry...</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div style="margin-top:24px; border-top:1px solid var(--grid-line); padding-top:16px;">
          <div class="row" style="justify-content:space-between;">
            <label style="margin:0;">Real-Time Participant Stream</label>
            <span class="loading" id="streamStatus"><span class="dot" style="width:6px; height:6px; background:var(--emerald); border-radius:50%; display:inline-block;"></span> Live Telemetry Active</span>
          </div>

          <div class="admin-grid" id="adminGrid">
            <div class="loading" style="padding:20px;">Waiting for participants to join room ${escapeHtml(state.code)}...</div>
          </div>
        </div>
      </div>
    `);
    wrap.appendChild(panel);

    const copyBtn = panel.querySelector('#copyUrlBtn');
    copyBtn.onclick = () => {
      const input = panel.querySelector('#joinUrlInput');
      input.select();
      navigator.clipboard.writeText(joinUrl);
      copyBtn.textContent = "Copied!";
      setTimeout(() => { copyBtn.textContent = "Copy Participant Link"; }, 2000);
    };

    panel.querySelector('#newRoomBtn').onclick = () => {
      if (state.adminPollInterval) {
        clearInterval(state.adminPollInterval);
        state.adminPollInterval = null;
      }
      if (state.eventSource) state.eventSource.close();
      state.screen = "admin_setup";
      render();
    };

    // Live Toolbar Click Handlers
    panel.querySelector('#liveToggleFs').onclick = () => {
      sendAdminSettingsUpdate({ fullScreenEnabled: !state.fullScreenEnabled }, panel);
    };

    panel.querySelector('#liveToggleWarn').onclick = () => {
      sendAdminSettingsUpdate({ warningsEnabled: !state.warningsEnabled }, panel);
    };

    panel.querySelector('#add1mBtn').onclick = () => {
      const newSec = Math.min(3600, state.timerSeconds + 60);
      sendAdminSettingsUpdate({ timerSeconds: newSec, addSeconds: 60 }, panel);
    };

    panel.querySelector('#add2mBtn').onclick = () => {
      const newSec = Math.min(3600, state.timerSeconds + 120);
      sendAdminSettingsUpdate({ timerSeconds: newSec, addSeconds: 120 }, panel);
    };

    panel.querySelector('#add5mBtn').onclick = () => {
      const newSec = Math.min(3600, state.timerSeconds + 300);
      sendAdminSettingsUpdate({ timerSeconds: newSec, addSeconds: 300 }, panel);
    };

    panel.querySelector('#sub5qBtn').onclick = () => {
      const current = Number(state.maxQuestions) || 20;
      const newQ = Math.max(3, current - 5);
      sendAdminSettingsUpdate({ maxQuestions: newQ, addQuestions: -5 }, panel);
    };

    panel.querySelector('#add5qBtn').onclick = () => {
      const current = Number(state.maxQuestions) || 20;
      const newQ = Math.min(100, current + 5);
      sendAdminSettingsUpdate({ maxQuestions: newQ, addQuestions: 5 }, panel);
    };

    async function fetchAdminLeaderboard(pnl) {
      if (!state.code) return;
      try {
        const resp = await fetch(`/api/rooms/${state.code}/leaderboard`);
        if (resp.ok) {
          const data = await resp.json();
          if (Array.isArray(data.leaderboard)) {
            data.leaderboard.forEach(p => {
              const existing = state.adminParticipants.get(p.name) || {};
              state.adminParticipants.set(p.name, Object.assign(existing, p));
            });
            localStorage.setItem(`vault_room_participants_${state.code}`, JSON.stringify(Array.from(state.adminParticipants.values())));
            updateAdminLeaderboard(pnl);
            updateAdminGrid(pnl);
          }
        }
      } catch (err) {
        const localKey = `vault_room_participants_${state.code}`;
        const saved = localStorage.getItem(localKey);
        if (saved) {
          try {
            const list = JSON.parse(saved);
            if (Array.isArray(list)) {
              list.forEach(p => {
                const existing = state.adminParticipants.get(p.name) || {};
                state.adminParticipants.set(p.name, Object.assign(existing, p));
              });
              updateAdminLeaderboard(pnl);
              updateAdminGrid(pnl);
            }
          } catch (e) {}
        }
      }
    }

    panel.querySelector('#adminRefreshLbBtn').onclick = () => {
      fetchAdminLeaderboard(panel);
    };

    // Auto-refresh leaderboard every 2.5 seconds so admin always sees live status & marks
    state.adminPollInterval = setInterval(() => {
      if (state.screen === "admin_live") {
        fetchAdminLeaderboard(panel);
      } else {
        if (state.adminPollInterval) clearInterval(state.adminPollInterval);
        state.adminPollInterval = null;
      }
    }, 2500);

    // Initial fetch
    fetchAdminLeaderboard(panel);

    // Connect to Server-Sent Events stream if backend available
    if (!state.eventSource && typeof EventSource !== 'undefined') {
      try {
        const es = new EventSource(`/api/rooms/${state.code}/stream`);
        state.eventSource = es;

        es.addEventListener('snapshot', (e) => {
          const data = JSON.parse(e.data);
          if (data.fullScreenEnabled !== undefined) state.fullScreenEnabled = data.fullScreenEnabled;
          if (data.warningsEnabled !== undefined) state.warningsEnabled = data.warningsEnabled;
          if (data.timerSeconds !== undefined) state.timerSeconds = data.timerSeconds;
          if (data.maxQuestions !== undefined) state.maxQuestions = data.maxQuestions;
          data.participants.forEach(p => {
            state.adminParticipants.set(p.name, p);
          });
          localStorage.setItem(`vault_room_participants_${state.code}`, JSON.stringify(Array.from(state.adminParticipants.values())));
          updateHostControlsToolbar(panel);
          updateAdminGrid(panel);
          updateAdminLeaderboard(panel);
        });

        es.addEventListener('settings_updated', (e) => {
          const data = JSON.parse(e.data);
          if (data.fullScreenEnabled !== undefined) state.fullScreenEnabled = data.fullScreenEnabled;
          if (data.warningsEnabled !== undefined) state.warningsEnabled = data.warningsEnabled;
          if (data.timerSeconds !== undefined) state.timerSeconds = data.timerSeconds;
          if (data.maxQuestions !== undefined) state.maxQuestions = data.maxQuestions;
          updateHostControlsToolbar(panel);
        });

        es.addEventListener('participant_joined', (e) => {
          const data = JSON.parse(e.data);
          const p = Object.assign({ status: "Ongoing", isFinished: false, qCount: 0, score: 0, maxQuestions: state.maxQuestions || 20 }, data.participant);
          state.adminParticipants.set(p.name, p);
          localStorage.setItem(`vault_room_participants_${state.code}`, JSON.stringify(Array.from(state.adminParticipants.values())));
          updateAdminGrid(panel);
          updateAdminLeaderboard(panel);
        });

        es.addEventListener('question_asked', (e) => {
          const data = JSON.parse(e.data);
          let p = state.adminParticipants.get(data.participantName);
          if (!p) {
            p = { name: data.participantName, history: [], qCount: 0, solved: false, score: 0, status: "Ongoing", maxQuestions: state.maxQuestions || 20 };
            state.adminParticipants.set(data.participantName, p);
          }
          p.history.push({ q: data.question, a: data.answer });
          p.qCount = data.qCount;
          p.solved = data.solved;
          p.score = data.score;
          if (data.maxQuestions) p.maxQuestions = data.maxQuestions;
          const currentMaxQ = p.maxQuestions || state.maxQuestions || 20;
          if (p.solved || p.qCount >= currentMaxQ) {
            p.status = "Finished";
            p.isFinished = true;
          }
          localStorage.setItem(`vault_room_participants_${state.code}`, JSON.stringify(Array.from(state.adminParticipants.values())));
          updateAdminGrid(panel);
          updateAdminLeaderboard(panel);
        });

        es.addEventListener('participant_timeout', (e) => {
          const data = JSON.parse(e.data);
          let p = state.adminParticipants.get(data.participantName);
          if (p) {
            p.timedOut = true;
            p.status = "Finished";
            p.isFinished = true;
            localStorage.setItem(`vault_room_participants_${state.code}`, JSON.stringify(Array.from(state.adminParticipants.values())));
            updateAdminGrid(panel);
            updateAdminLeaderboard(panel);
          }
        });

        es.addEventListener('participant_eliminated', (e) => {
          const data = JSON.parse(e.data);
          let p = state.adminParticipants.get(data.participantName);
          if (!p) {
            p = { name: data.participantName, history: [], qCount: 0, solved: false, score: 0 };
            state.adminParticipants.set(data.participantName, p);
          }
          p.cheatingTerminated = true;
          p.score = 0;
          p.isFinished = true;
          p.status = "Eliminated";
          p.statusDetail = "Eliminated (Fullscreen Exit)";
          localStorage.setItem(`vault_room_participants_${state.code}`, JSON.stringify(Array.from(state.adminParticipants.values())));
          updateAdminGrid(panel);
          updateAdminLeaderboard(panel);
        });

        es.onerror = () => {
          const statusEl = panel.querySelector('#streamStatus');
          if (statusEl) statusEl.textContent = "Offline / Local Mode";
        };
      } catch (e) {
        console.log("SSE Stream unavailable in standalone local mode");
      }
    }

    updateAdminLeaderboard(panel);
  }

  function updateAdminLeaderboard(panel) {
    const tbody = panel.querySelector('#adminLbBody');
    if (!tbody) return;

    const list = Array.from(state.adminParticipants.values());
    const totalEl = panel.querySelector('#adminStatJoined');
    const crackedEl = panel.querySelector('#adminStatCracked');
    const topScoreEl = panel.querySelector('#adminStatTopScore');

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="loading">Waiting for participants to join and log telemetry...</td></tr>`;
      if (totalEl) totalEl.textContent = '0';
      if (crackedEl) crackedEl.textContent = '0';
      if (topScoreEl) topScoreEl.textContent = '0';
      return;
    }

    // Sort by marks/score descending, then solved descending, then questions ascending.
    // Critical Integrity Rule: Eliminated participants (cheatingTerminated) rank at the bottom with 0 pts!
    const sorted = [...list].sort((a,b) => {
      if (a.cheatingTerminated && !b.cheatingTerminated) return 1;
      if (!a.cheatingTerminated && b.cheatingTerminated) return -1;
      if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
      if (a.solved !== b.solved) return b.solved ? 1 : -1;
      return (a.qCount || 0) - (b.qCount || 0);
    });

    const crackedCount = sorted.filter(p => p.solved).length;
    const topScore = sorted[0]?.score || 0;

    if (totalEl) totalEl.textContent = sorted.length;
    if (crackedEl) crackedEl.textContent = crackedCount;
    if (topScoreEl) topScoreEl.textContent = topScore;

    tbody.innerHTML = sorted.map((p, i) => {
      const rankBadge = i === 0 ? `<span class="rank-badge gold">#1</span>` : (i === 1 ? `<span class="rank-badge silver">#2</span>` : (i === 2 ? `<span class="rank-badge bronze">#3</span>` : `<span class="rank-badge">#${i+1}</span>`));
      const pMaxQ = p.maxQuestions || state.maxQuestions || 20;
      const isFinished = Boolean(p.isFinished || p.status === "Finished" || p.status === "Eliminated" || p.solved || p.timedOut || p.cheatingTerminated || (p.qCount >= pMaxQ));
      
      let statusPill = '';
      if (p.cheatingTerminated || p.status === "Eliminated") {
        statusPill = `<span class="status-pill eliminated">🚫 Eliminated (0 pts)</span>`;
      } else if (isFinished) {
        let sub = 'Done';
        if (p.solved) sub = 'Cracked';
        else if (p.timedOut) sub = 'Timeout';
        else if (p.qCount >= pMaxQ) sub = 'Max Qs';
        statusPill = `<span class="status-pill finished">✓ Finished (${sub})</span>`;
      } else {
        statusPill = `<span class="status-pill ongoing"><span class="status-dot"></span>Ongoing</span>`;
      }

      const displayScore = p.cheatingTerminated ? 0 : (p.score || 0);

      return `
        <tr class="lb-row">
          <td>${rankBadge}</td>
          <td><strong>${escapeHtml(p.name)}</strong></td>
          <td>${statusPill}</td>
          <td>${p.qCount}/${pMaxQ} Qs</td>
          <td style="text-align:right; font-weight:700; color:${p.cheatingTerminated ? 'var(--danger)' : 'var(--cyan)'}; font-size:13px;">${displayScore} pts</td>
        </tr>
      `;
    }).join('');
  }

  function updateAdminGrid(panel) {
    const grid = panel.querySelector('#adminGrid');
    if (!grid) return;

    if (state.adminParticipants.size === 0) {
      grid.innerHTML = `<div class="loading" style="padding:20px;">Waiting for participants to join room ${escapeHtml(state.code)}...</div>`;
      return;
    }

    grid.innerHTML = "";
    state.adminParticipants.forEach(p => {
      const pMaxQ = p.maxQuestions || state.maxQuestions || 20;
      let statusText = 'Interrogating...';
      let statusColor = 'var(--accent)';
      if (p.cheatingTerminated) {
        statusText = 'Eliminated (Fullscreen Exit)';
        statusColor = 'var(--danger)';
      } else if (p.solved) {
        statusText = 'Vault Cracked!';
        statusColor = 'var(--emerald)';
      } else if (p.timedOut) {
        statusText = 'Time Finished';
        statusColor = 'var(--text-dim)';
      }

      const card = el(`
        <div class="participant-card">
          <div class="header-row">
            <span class="p-name">${escapeHtml(p.name)}</span>
            <span class="p-qcount">${p.qCount}/${pMaxQ} Qs</span>
          </div>
          <div class="row" style="margin-bottom:8px; font-size:12px; justify-content:space-between;">
            <span style="color:var(--text-dim);">Status: <strong style="color:${statusColor}">${statusText}</strong></span>
            <span style="color:${p.cheatingTerminated ? 'var(--danger)' : 'var(--cyan)'}; font-weight:700;">${p.cheatingTerminated ? 0 : p.score} pts</span>
          </div>
          <div class="p-history">
            ${p.history.length === 0 ? '<div style="color:var(--text-dim); font-style:italic;">No questions asked yet.</div>' : ''}
            ${p.history.map(h => `
              <div class="p-history-item">
                <div class="q">Q: ${escapeHtml(h.q)}</div>
                <div class="a">A: ${escapeHtml(h.a)}</div>
              </div>
            `).join('')}
          </div>
        </div>
      `);
      grid.appendChild(card);
    });
  }

  // 4. Participant Room Join Entry Screen
  function renderJoin(wrap) {
    if (window.location.pathname !== '/join' && !window.location.pathname.startsWith('/join')) {
      window.history.pushState({}, '', '/join' + window.location.search);
    }

    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }

    const backBtn = el(`<span class="backlink">&larr; back to role selection</span>`);
    backBtn.onclick = () => { state.screen = "role"; render(); };
    wrap.appendChild(backBtn);

    header(wrap, "PARTICIPANT ENTRY", "Enter the Vault", "Enter your callsign and the room code supplied by your Admin. Interrogate the AI Oracle with sharp questions — subtle hints will guide your path.");

    const defaultCode = state.joinCodeInput || state.code || "";

    const panel = el(`
      <div class="panel">
        <label>Your Name / Callsign</label>
        <input type="text" id="pNameInput" placeholder="e.g. Alex" />

        <label>Vault Room Code</label>
        <input type="text" id="pCodeInput" placeholder="e.g. K7QXZ" value="${escapeHtml(defaultCode)}" style="text-transform:uppercase;" />

        <label>API Key</label>
        <input type="password" id="pApiKeyInput" placeholder="e.g. AQ.Ab8RN6K..." value="${escapeHtml(state.apiKey)}" />

        <div class="row" style="margin-top:20px;">
          <button id="enterVaultBtn">Access Vault</button>
        </div>
        <div class="error-msg" id="joinErr" style="display:none;"></div>
      </div>
    `);
    wrap.appendChild(panel);

    panel.querySelector('#enterVaultBtn').onclick = async () => {
      const name = panel.querySelector('#pNameInput').value.trim();
      const code = panel.querySelector('#pCodeInput').value.trim().toUpperCase();
      const apiKey = panel.querySelector('#pApiKeyInput').value.trim();
      state.apiKey = apiKey;
      if (apiKey) {
        localStorage.setItem('participant_api_key', apiKey);
      }
      const errBox = panel.querySelector('#joinErr');
      errBox.style.display = "none";

      if (!name || !code || !apiKey) {
        errBox.style.display = "block";
        errBox.textContent = "Please enter your callsign, vault room code, and API key to enter.";
        return;
      }

      try {
        const resp = await fetch('/api/rooms/join', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, name })
        });

        if (resp.ok) {
          const data = await resp.json();
          state.code = data.code;
          state.name = data.participant.name;
          state.roomType = data.roomType;
          state.timerSeconds = data.timerSeconds || state.timerSeconds;
          state.maxQuestions = data.maxQuestions || (data.room && data.room.maxQuestions) || state.maxQuestions || 20;
          state.fullScreenEnabled = data.fullScreenEnabled !== undefined ? data.fullScreenEnabled : true;
          state.warningsEnabled = data.warningsEnabled !== undefined ? data.warningsEnabled : true;
          state.showLeaderboard = data.showLeaderboard !== undefined ? data.showLeaderboard : false;
          state.leaderboard = data.leaderboard || [];
          state.history = data.participant.history || [];
          state.qCount = data.participant.qCount || 0;
          state.solved = data.participant.solved || false;
          state.timedOut = false;
          state.tabSwitchWarnings = 0;
          state.cheatingTerminated = false;
          state.timerStartAt = null;

          // Register in local participant storage so admin leaderboard immediately displays Ongoing status
          try {
            const localKey = `vault_room_participants_${state.code}`;
            let cached = JSON.parse(localStorage.getItem(localKey) || '[]');
            const pIdx = cached.findIndex(p => p.name === state.name);
            const pData = {
              name: state.name,
              qCount: state.qCount || 0,
              maxQuestions: state.maxQuestions,
              score: 0,
              solved: false,
              timedOut: false,
              isFinished: false,
              status: "Ongoing",
              statusDetail: "Ongoing",
              history: []
            };
            if (pIdx >= 0) cached[pIdx] = Object.assign(cached[pIdx], pData);
            else cached.push(pData);
            localStorage.setItem(localKey, JSON.stringify(cached));
          } catch (err) {}

          state.screen = "game";
          render();
          return;
        } else {
          const errData = await resp.json();
          throw new Error(errData.error || "Room not found");
        }
      } catch (e) {
        // Fallback for standalone offline execution
        const localData = localStorage.getItem(`vault_room_${code}`);
        if (localData) {
          const room = JSON.parse(localData);
          state.code = room.code;
          state.name = name;
          state.roomType = room.roomType;
          state.timerSeconds = room.timerSeconds || state.timerSeconds;
          state.maxQuestions = room.maxQuestions || state.maxQuestions || 20;
          state.fullScreenEnabled = room.fullScreenEnabled !== undefined ? room.fullScreenEnabled : true;
          state.warningsEnabled = room.warningsEnabled !== undefined ? room.warningsEnabled : true;
          state.showLeaderboard = room.showLeaderboard !== undefined ? room.showLeaderboard : false;
          state.leaderboard = room.leaderboard || [];
          state.generatedTerm = room.term;
          state.history = [];
          state.qCount = 0;
          state.solved = false;
          state.timedOut = false;
          state.tabSwitchWarnings = 0;
          state.cheatingTerminated = false;
          state.timerStartAt = null;

          // Register in local participant storage so admin leaderboard immediately displays Ongoing status
          try {
            const localKey = `vault_room_participants_${state.code}`;
            let cached = JSON.parse(localStorage.getItem(localKey) || '[]');
            const pIdx = cached.findIndex(p => p.name === state.name);
            const pData = {
              name: state.name,
              qCount: 0,
              maxQuestions: state.maxQuestions,
              score: 0,
              solved: false,
              timedOut: false,
              isFinished: false,
              status: "Ongoing",
              statusDetail: "Ongoing",
              history: []
            };
            if (pIdx >= 0) cached[pIdx] = Object.assign(cached[pIdx], pData);
            else cached.push(pData);
            localStorage.setItem(localKey, JSON.stringify(cached));
          } catch (err) {}

          state.screen = "game";
          render();
          return;
        }

        errBox.style.display = "block";
        errBox.textContent = e.message || "Vault room not found. Check code with host.";
      }
    };
  }

  // 5. Participant Vault Interrogation Screen (Full Access Controls & Leaderboard)
  function renderGame(wrap) {
    // Participant entered exam: ensure anti-cheat is disarmed while page opens
    disarmAntiCheatSystem();

    if (state.fullScreenEnabled) {
      if (document.fullscreenElement) {
        armAntiCheatSystem(2000);
      } else {
        requestFullScreen(() => {
          const gate = document.getElementById('fullscreenGateModal');
          if (gate) gate.remove();
        });
        // If browser requires explicit user gesture, show gate after short tick
        setTimeout(() => {
          if (state.screen === "game" && state.fullScreenEnabled && !document.fullscreenElement) {
            showFullscreenEntranceGate();
          } else if (state.screen === "game") {
            armAntiCheatSystem(2000);
          }
        }, 350);
      }
    } else {
      armAntiCheatSystem(2000);
    }

    const maxQ = state.maxQuestions || 20;
    const remaining = Math.max(0, maxQ - state.qCount);

    header(
      wrap,
      `VAULT ROOM ${escapeHtml(state.code)} · ${escapeHtml(state.roomType)}`,
      "Interrogate the Oracle",
      `${escapeHtml(state.name)}, ask one tactical question at a time. ${remaining} questions remaining.`
    );

    const pct = Math.max(0, Math.min(1, state.qCount / maxQ));
    const dashArray = 2 * Math.PI * 27;
    const dashOffset = dashArray * (1 - pct);
    const elapsedSeconds = state.timerStartAt ? Math.floor((Date.now() - state.timerStartAt) / 1000) : 0;
    const secondsLeft = Math.max(0, state.timerSeconds - elapsedSeconds);
    const timerActive = !state.solved && !state.timedOut && remaining > 0 && secondsLeft > 0;

    const panel = el(`
      <div class="panel">
        <!-- Host Allotted Time & Proctoring Status -->
        <div class="exam-status-bar">
          <div class="allotted-time-badge">
            <span class="dot"></span>
            <span>Exam Duration Allotted by Host: <strong>${formatTime(state.timerSeconds)}</strong> (${state.timerSeconds}s)</span>
          </div>
          ${state.warningsEnabled ? `
            <div class="integrity-badge arming" id="examIntegrityBadge">
              <span class="dot" style="width:7px; height:7px; border-radius:50%; background:#ffb300; display:inline-block; margin-right:6px;"></span>
              <span>⏳ Initializing Proctoring...</span>
            </div>
          ` : ''}
        </div>

        <div class="dial-wrap" style="justify-content:space-between; gap:18px;">
          <div style="flex:1; min-width:180px;">
            <svg width="64" height="64" viewBox="0 0 64 64">
              <circle cx="32" cy="32" r="27" fill="none" stroke="var(--grid-line)" stroke-width="6"/>
              <circle cx="32" cy="32" r="27" fill="none" stroke="var(--accent)" stroke-width="6" stroke-dasharray="${dashArray}" stroke-dashoffset="${dashOffset}" stroke-linecap="round" transform="rotate(-90 32 32)"/>
            </svg>
            <div class="dial-stats">
              <div class="n">${remaining}</div>
              <div class="lbl">Questions Left</div>
            </div>
          </div>
          <div style="min-width:180px; text-align:right;">
            <div class="timer-box ${secondsLeft <= 30 && secondsLeft > 0 ? 'urgent' : ''}">${timerActive ? '⏱' : '⏳'} ${formatTime(secondsLeft)}</div>
            <div class="allotted-sub">Time Left · Allotted: ${formatTime(state.timerSeconds)}</div>
          </div>
        </div>

        <!-- Progressive Word Clues Container (Unlocks adaptively based on maxQuestions) -->
        <div id="clueContainer" style="margin-bottom:16px;"></div>

        <div class="chat" id="chatBox"></div>

        <label style="margin-top:0;">Question the Oracle</label>
        <div class="row">
          <input type="text" id="qInput" placeholder="e.g. Does it operate in O(N log N) time complexity?" style="flex:1;" ${!timerActive ? 'disabled' : ''} />
          <button id="askBtn" ${!timerActive ? 'disabled' : ''}>Ask</button>
        </div>

        <label>Make a Direct Term Guess</label>
        <div class="row">
          <input type="text" id="guessInput" placeholder="Type exact term (e.g. Red-Black Tree)" style="flex:1;" ${!timerActive ? 'disabled' : ''} />
          <button class="ghost" id="guessBtn" ${!timerActive ? 'disabled' : ''}>Guess Term</button>
        </div>

        <div class="loading" id="loadingMsg" style="display:none; margin-top:12px;">
          <span class="dot" style="width:6px; height:6px; background:var(--accent); border-radius:50%;"></span>
          Oracle is analyzing properties &amp; preparing nudge...
        </div>
      </div>
    `);
    wrap.appendChild(panel);

    const chatBox = panel.querySelector('#chatBox');
    state.history.forEach(h => {
      chatBox.appendChild(el(`
        <div class="msg user">
          <div class="who">${escapeHtml(state.name)}</div>
          <div class="bubble">${escapeHtml(h.q)}</div>
        </div>
      `));
      chatBox.appendChild(el(`
        <div class="msg ai">
          <div class="who">AI Oracle</div>
          <div class="bubble">
            ${escapeHtml(h.a)}
            <span class="badge ${badgeFor(h.a)}">${badgeFor(h.a)}</span>
          </div>
        </div>
      `));
    });
    chatBox.scrollTop = chatBox.scrollHeight;

    // Render progressive word clue status
    updateClueUI();

    const qInput = panel.querySelector('#qInput');
    const guessInput = panel.querySelector('#guessInput');
    const askBtn = panel.querySelector('#askBtn');
    const guessBtn = panel.querySelector('#guessBtn');
    const loadingMsg = panel.querySelector('#loadingMsg');

    // Auto-exit when allotted exam duration is finished
    async function endGameDueToTimeout() {
      disarmAntiCheatSystem();
      if (state.timerInterval) {
        clearInterval(state.timerInterval);
        state.timerInterval = null;
      }
      state.timedOut = true;
      state.solved = false;
      state.finalScore = calculateScore(false, state.qCount, state.maxQuestions, state.history);

      if (document.exitFullscreen && document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }

      try {
        await fetch('/api/rooms/timeout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: state.code, name: state.name })
        });
      } catch (e) {}

      // Update local participant cache so admin leaderboard shows live marks and status
      try {
        const localKey = `vault_room_participants_${state.code}`;
        let cached = JSON.parse(localStorage.getItem(localKey) || '[]');
        const pIdx = cached.findIndex(p => p.name === state.name);
        const pUpdated = {
          name: state.name,
          qCount: state.qCount,
          maxQuestions: state.maxQuestions,
          score: state.finalScore,
          solved: false,
          timedOut: true,
          cheatingTerminated: state.cheatingTerminated,
          isFinished: true,
          status: "Finished",
          statusDetail: "Finished (Timeout)"
        };
        if (pIdx >= 0) cached[pIdx] = Object.assign(cached[pIdx], pUpdated);
        else cached.push(pUpdated);
        localStorage.setItem(localKey, JSON.stringify(cached));
      } catch (err) {}

      state.screen = "reveal";
      render();
    }

    function advanceTimer() {
      if (state.solved || state.timedOut) return;
      if (!state.timerStartAt) state.timerStartAt = Date.now();
      const elapsed = Math.floor((Date.now() - state.timerStartAt) / 1000);
      const left = state.timerSeconds - elapsed;
      if (left <= 0) {
        endGameDueToTimeout();
      } else {
        const timerBox = panel.querySelector('.timer-box');
        if (timerBox) {
          timerBox.className = `timer-box ${left <= 30 ? 'urgent' : ''}`;
          timerBox.textContent = `⏱ ${formatTime(left)}`;
        }
      }
    }

    if (!state.timerStartAt) {
      state.timerStartAt = Date.now();
    }
    if (!state.timerInterval) {
      state.timerInterval = setInterval(() => {
        advanceTimer();
      }, 1000);
    }

    // Connect to Sanitized Participant Live Telemetry SSE Stream
    if (!state.participantEventSource && typeof EventSource !== 'undefined') {
      try {
        const pes = new EventSource(`/api/rooms/${state.code}/participant-stream`);
        state.participantEventSource = pes;

        pes.addEventListener('snapshot', (e) => {
          const data = JSON.parse(e.data);
          if (data.fullScreenEnabled !== undefined) state.fullScreenEnabled = data.fullScreenEnabled;
          if (data.warningsEnabled !== undefined) state.warningsEnabled = data.warningsEnabled;
          if (data.timerSeconds !== undefined) state.timerSeconds = data.timerSeconds;
          if (data.maxQuestions !== undefined) state.maxQuestions = data.maxQuestions;
        });

        pes.addEventListener('settings_updated', (e) => {
          const data = JSON.parse(e.data);
          let needsFullRender = false;
          if (data.fullScreenEnabled !== undefined && data.fullScreenEnabled !== state.fullScreenEnabled) {
            state.fullScreenEnabled = data.fullScreenEnabled;
            if (state.fullScreenEnabled) requestFullScreen();
            needsFullRender = true;
          }
          if (data.warningsEnabled !== undefined && data.warningsEnabled !== state.warningsEnabled) {
            state.warningsEnabled = data.warningsEnabled;
            needsFullRender = true;
          }
          if (data.timerSeconds !== undefined && data.timerSeconds !== state.timerSeconds) {
            state.timerSeconds = data.timerSeconds;
            needsFullRender = true;
          }
          if (data.maxQuestions !== undefined && data.maxQuestions !== state.maxQuestions) {
            state.maxQuestions = data.maxQuestions;
            needsFullRender = true;
          }

          if (needsFullRender) {
            render();
          }
        });

        pes.onerror = () => {
          // Local fallback
        };
      } catch (err) {
        console.log("Participant SSE unavailable in standalone local mode");
      }
    }

    async function submitQuestion(qText) {
      const curMaxQ = state.maxQuestions || 20;
      if (!qText || state.qCount >= curMaxQ || state.timedOut) return;
      const elapsed = Math.floor((Date.now() - state.timerStartAt) / 1000);
      if (elapsed >= state.timerSeconds) {
        endGameDueToTimeout();
        return;
      }

      askBtn.disabled = true;
      guessBtn.disabled = true;
      loadingMsg.style.display = "flex";

      let answer = "";
      let solved = false;
      let score = 0;

      try {
        const resp = await fetch('/api/oracle/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: state.code,
            name: state.name,
            question: qText,
            apiKey: state.apiKey
          })
        });

        if (resp.ok) {
          const data = await resp.json();
          answer = data.answer;
          state.qCount = data.qCount;
          if (data.maxQuestions) state.maxQuestions = data.maxQuestions;
          solved = data.solved;
          score = data.score;
          if (data.clue) {
            state.currentClue = data.clue;
          } else {
            state.currentClue = getProgressiveClues(state.generatedTerm, state.qCount, state.maxQuestions);
          }
        } else {
          throw new Error("API call failed");
        }
      } catch (e) {
        // Offline smart nudge fallback engine
        const termToMatch = (state.generatedTerm || "").toLowerCase();
        const qLower = qText.toLowerCase();

        state.qCount += 1;
        if (termToMatch && (qLower.includes(termToMatch) || qLower.replace('is it ', '').trim() === termToMatch)) {
          answer = `CORRECT! The secret technical term was ${state.generatedTerm}. Excellent deduction!`;
          solved = true;
        } else if (qLower.includes("loop") || qLower.includes("variable") || qLower.includes("memory") || qLower.includes("function") || qLower.includes("data") || qLower.includes("structure")) {
          answer = `Partially — you are exploring relevant structural properties of ${state.roomType}, investigate how this concept handles execution or state.`;
        } else {
          answer = `No — unlike that concept, this secret term in ${state.roomType} serves a distinct operational purpose.`;
        }
        score = calculateScore(solved, state.qCount, state.maxQuestions, state.history);
        state.currentClue = getProgressiveClues(state.generatedTerm, state.qCount, state.maxQuestions);
      }

      state.history.push({ q: qText, a: answer });
      state.solved = solved;
      state.finalScore = score;

      const activeMaxQ = state.maxQuestions || 20;
      const isFin = Boolean(solved || state.qCount >= activeMaxQ || state.timedOut || state.cheatingTerminated);

      // Update local participant cache so admin leaderboard shows live marks and status
      try {
        const localKey = `vault_room_participants_${state.code}`;
        let cached = JSON.parse(localStorage.getItem(localKey) || '[]');
        const pIdx = cached.findIndex(p => p.name === state.name);
        const pUpdated = {
          name: state.name,
          qCount: state.qCount,
          maxQuestions: activeMaxQ,
          score: score,
          solved: solved,
          timedOut: state.timedOut,
          cheatingTerminated: state.cheatingTerminated,
          isFinished: isFin,
          status: isFin ? "Finished" : "Ongoing",
          statusDetail: solved ? "Finished (Cracked)" : (isFin ? "Finished (Max Qs)" : "Ongoing")
        };
        if (pIdx >= 0) cached[pIdx] = Object.assign(cached[pIdx], pUpdated);
        else cached.push(pUpdated);
        localStorage.setItem(localKey, JSON.stringify(cached));
      } catch (err) {}

      updateClueUI(state.currentClue);

      if (solved || state.qCount >= activeMaxQ) {
        disarmAntiCheatSystem();
        if (state.timerInterval) {
          clearInterval(state.timerInterval);
          state.timerInterval = null;
        }
        if (document.exitFullscreen && document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }
        state.screen = "reveal";
        render();
        return;
      }

      render();
    }

    askBtn.onclick = () => {
      const v = qInput.value.trim();
      qInput.value = "";
      submitQuestion(v);
    };

    qInput.onkeydown = (e) => {
      if (e.key === "Enter") askBtn.click();
    };

    guessBtn.onclick = () => {
      const v = guessInput.value.trim();
      guessInput.value = "";
      if (v) submitQuestion(`Is it ${v}?`);
    };

    guessInput.onkeydown = (e) => {
      if (e.key === "Enter") guessBtn.click();
    };
  }

  // 6. Reveal Victory / Defeat / Disqualified / Timeout Screen
  function renderReveal(wrap) {
    disarmAntiCheatSystem();
    if (document.exitFullscreen && document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }

    const currentMaxQ = state.maxQuestions || 20;

    const title = state.cheatingTerminated
      ? "EXAM TERMINATED · DISQUALIFIED"
      : (state.timedOut
        ? "EXAM TIME FINISHED"
        : (state.solved ? "Vault Cracked" : "Vault Sealed"));

    header(wrap, `ROOM ${escapeHtml(state.code)}`, title, "");

    const unusedQ = Math.max(0, currentMaxQ - state.qCount);
    const subText = state.cheatingTerminated
      ? `You have been permanently eliminated for leaving full screen after receiving the fair warning. In accordance with strict exam integrity policies, 0 points have been awarded regardless of question count or closeness to the answer.`
      : state.timedOut
        ? `The allotted exam duration has ended (${formatTime(state.timerSeconds)}). Efficiency marks awarded: ${state.finalScore} pts (${unusedQ} unused question economy preserved).`
        : state.solved
          ? `Vault Cracked in ${state.qCount} question(s)! Solved Bonus (100) + Question Economy (+${unusedQ * 5}): ${state.finalScore} pts.`
          : `Reached max question limit (${currentMaxQ}). Efficiency score awarded: ${state.finalScore} pts.`;

    const scoreTag = state.cheatingTerminated
      ? "Disqualified · Strict 0 Points Applied"
      : (state.solved
        ? "Vault Cracked (100+) + Question Economy Bonus"
        : (state.qCount > 0
          ? `Unsolved Efficiency Score · ${unusedQ} Questions Preserved`
          : "No Questions Asked (0 pts)"));

    const panelClass = state.cheatingTerminated ? "panel disqualified" : "panel win";
    const tagText = state.cheatingTerminated
      ? "Integrity Violation — Candidate Eliminated"
      : (state.timedOut ? "Time Allotted Ended · Secret Term" : "The secret technical term was");

    const panel = el(`
      <div class="${panelClass}">
        <div class="card-tag">${tagText}</div>
        <div class="term">${escapeHtml(state.generatedTerm || state.roomType)}</div>
        <div class="score">${state.cheatingTerminated ? 0 : state.finalScore}</div>
        <div style="font-size:12px; font-weight:600; color:${state.cheatingTerminated ? 'var(--danger)' : 'var(--cyan)'}; margin-top:-6px; margin-bottom:12px; letter-spacing:.05em;">
          ${scoreTag}
        </div>
        <div class="sub" style="margin: 10px auto;">
          ${subText}
        </div>
        <div class="row" style="justify-content:center; margin-top:24px;">
          <button id="againBtn">Join Another Room</button>
        </div>
      </div>
    `);
    wrap.appendChild(panel);

    panel.querySelector('#againBtn').onclick = () => {
      disarmAntiCheatSystem();
      state.screen = "join";
      state.history = [];
      state.qCount = 0;
      state.solved = false;
      state.timedOut = false;
      state.cheatingTerminated = false;
      state.tabSwitchWarnings = 0;
      state.finalScore = 0;
      render();
    };
  }

  // Initial Run
  window.addEventListener('DOMContentLoaded', () => {
    parseUrlRoute();
    render();
  });
})();
