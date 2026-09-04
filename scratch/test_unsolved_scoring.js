const http = require('http');

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, res => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => resolve(JSON.parse(raw)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function get(path) {
  return new Promise((resolve, reject) => {
    http.get({
      hostname: 'localhost',
      port: 3000,
      path
    }, res => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => resolve(JSON.parse(raw)));
    }).on('error', reject);
  });
}

async function run() {
  console.log("=== Testing Efficiency Scoring When Participants Fail To Find The Word ===");

  // 1. Create Room
  const room = await post('/api/rooms/create', {
    roomType: "Programming Fundamentals",
    termMode: "manual",
    manualTerm: "Loop",
    timerSeconds: 180,
    fullScreenEnabled: true,
    warningsEnabled: true
  });
  const code = room.code;
  console.log(`Room created: ${code}, Term: ${room.term}`);

  // 2. Join 5 participants
  await post('/api/rooms/join', { code, name: "Alice" });   // will ask 4 questions
  await post('/api/rooms/join', { code, name: "Bob" });     // will ask 12 questions
  await post('/api/rooms/join', { code, name: "Charlie" }); // will ask 20 questions (exhaust limit)
  await post('/api/rooms/join', { code, name: "David" });   // 0 questions (AFK / inactive)
  await post('/api/rooms/join', { code, name: "Eva" });     // will crack in 6 questions

  // Alice asks 4 questions (not solving)
  for (let i = 1; i <= 4; i++) {
    await post('/api/oracle/ask', { code, name: "Alice", question: `Is it related to memory storage step ${i}?` });
  }
  // Alice times out
  await post('/api/rooms/timeout', { code, name: "Alice" });

  // Bob asks 12 questions (not solving)
  for (let i = 1; i <= 12; i++) {
    await post('/api/oracle/ask', { code, name: "Bob", question: `Is it about hardware component ${i}?` });
  }
  // Bob times out
  await post('/api/rooms/timeout', { code, name: "Bob" });

  // Charlie asks 20 questions (exhausts max limit)
  for (let i = 1; i <= 20; i++) {
    await post('/api/oracle/ask', { code, name: "Charlie", question: `Is it concept ${i}?` });
  }

  // Eva asks 5 questions, then cracks on 6th
  for (let i = 1; i <= 5; i++) {
    await post('/api/oracle/ask', { code, name: "Eva", question: `Is it about iteration ${i}?` });
  }
  const evaSolve = await post('/api/oracle/ask', { code, name: "Eva", question: "Is it Loop?" });
  console.log(`Eva solved: ${evaSolve.solved}, answer: ${evaSolve.answer}, score: ${evaSolve.score}`);

  // Fetch Leaderboard
  const lbData = await get(`/api/rooms/${code}/leaderboard`);
  console.log("\nFinal Leaderboard Roster:");
  console.table(lbData.leaderboard.map(p => ({
    Rank: p.rank,
    Name: p.name,
    Score: p.score,
    QCount: p.qCount,
    Solved: p.solved,
    Status: p.status,
    StatusDetail: p.statusDetail
  })));

  // Verifications
  const lb = lbData.leaderboard;
  const eva = lb.find(p => p.name === "Eva");
  const alice = lb.find(p => p.name === "Alice");
  const bob = lb.find(p => p.name === "Bob");
  const charlie = lb.find(p => p.name === "Charlie");
  const david = lb.find(p => p.name === "David");

  console.log("\nVerifying Score Constraints:");
  console.log(`- Eva (Solved 6 Qs): ${eva.score} pts (expect >= 100) -> ${eva.score >= 100 ? 'PASS' : 'FAIL'}`);
  console.log(`- Alice (Unsolved 4 Qs): ${alice.score} pts`);
  console.log(`- Bob (Unsolved 12 Qs): ${bob.score} pts`);
  console.log(`- Charlie (Unsolved 20 Qs): ${charlie.score} pts`);
  console.log(`- David (Inactive 0 Qs): ${david.score} pts`);

  const rule1 = eva.score > alice.score;
  const rule2 = alice.score > bob.score; // Lesser questions = higher points!
  const rule3 = bob.score > charlie.score; // Lesser questions = higher points!
  const rule4 = charlie.score > david.score; // Attempted questions beats inactive (0 Qs)
  const rule5 = david.score === 0;

  console.log(`\nCondition 1: Solved beats Unsolved (Eva > Alice): ${rule1 ? 'PASS' : 'FAIL'}`);
  console.log(`Condition 2: 4 Qs beats 12 Qs (Alice > Bob): ${rule2 ? 'PASS' : 'FAIL'}`);
  console.log(`Condition 3: 12 Qs beats 20 Qs (Bob > Charlie): ${rule3 ? 'PASS' : 'FAIL'}`);
  console.log(`Condition 4: 20 Qs attempted beats Inactive 0 Qs (Charlie > David): ${rule4 ? 'PASS' : 'FAIL'}`);
  console.log(`Condition 5: Inactive (0 Qs) gets 0 pts: ${rule5 ? 'PASS' : 'FAIL'}`);

  if (rule1 && rule2 && rule3 && rule4 && rule5) {
    console.log("\n>>> ALL TESTS PASSED! Efficiency scoring rule ('Lesser the questions asked, higher the points allotted') is 100% verified!");
  } else {
    console.error("\n>>> TESTS FAILED!");
    process.exit(1);
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
