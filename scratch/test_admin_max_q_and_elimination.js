const http = require('http');

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(buf) });
        } catch(e) {
          resolve({ status: res.statusCode, raw: buf });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function get(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: 'GET'
    }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(buf) });
        } catch(e) {
          resolve({ status: res.statusCode, raw: buf });
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function runTests() {
  console.log('=== TEST SUITE: Admin Question Limit & Strict 0-Score Elimination ===\n');

  // Test 1: Create room with custom maxQuestions (10)
  console.log('1. Creating room with maxQuestions = 10...');
  const createRes = await post('/api/rooms/create', {
    roomType: 'Programming Fundamentals',
    termMode: 'manual',
    manualTerm: 'Recursion',
    timerSeconds: 300,
    maxQuestions: 10,
    fullScreenEnabled: true,
    warningsEnabled: true
  });
  console.log('Room create status:', createRes.status);
  console.log('Room Code:', createRes.data.code);
  console.log('Room maxQuestions:', createRes.data.maxQuestions);
  if (createRes.data.maxQuestions !== 10) throw new Error('Expected maxQuestions to be 10');

  const roomCode = createRes.data.code;

  // Test 2: Participant 1 joins and asks questions
  console.log('\n2. Participant 1 (Student Alice) joins...');
  const join1 = await post('/api/rooms/join', { code: roomCode, name: 'Alice' });
  console.log('Join Alice status:', join1.status, 'maxQuestions received:', join1.data.maxQuestions);
  if (join1.data.maxQuestions !== 10) throw new Error('Alice should receive maxQuestions: 10');

  // Participant 2 (Student Bob) joins
  console.log('\n3. Participant 2 (Student Bob) joins...');
  const join2 = await post('/api/rooms/join', { code: roomCode, name: 'Bob' });
  console.log('Join Bob status:', join2.status);

  // Bob asks 2 questions and gets close
  console.log('\n4. Bob asks questions and gets close...');
  const ask1 = await post('/api/oracle/ask', { code: roomCode, name: 'Bob', question: 'Is it a programming technique where a function calls itself?' });
  console.log('Bob Q1 response:', ask1.data.answer);
  console.log('Bob score so far:', ask1.data.score);

  const ask2 = await post('/api/oracle/ask', { code: roomCode, name: 'Bob', question: 'Does it require a base case?' });
  console.log('Bob Q2 response:', ask2.data.answer);
  console.log('Bob score so far:', ask2.data.score);
  if (ask2.data.score <= 0) throw new Error('Bob should have a positive score before violation');

  // Test 3: Admin live update of settings (increases max questions from 10 to 15)
  console.log('\n5. Admin dynamically adjusts questions to 15 (+5 Qs)...');
  const settingsRes = await post(`/api/rooms/${roomCode}/settings`, { maxQuestions: 15, addQuestions: 5 });
  console.log('Admin settings update status:', settingsRes.status, 'maxQuestions:', settingsRes.data.maxQuestions);
  if (settingsRes.data.maxQuestions !== 15) throw new Error('Expected updated maxQuestions to be 15');

  // Test 4: Participant Bob leaves full screen after fair warning -> PERMANENT ELIMINATION (0 POINTS)
  console.log('\n6. Participant Bob leaves full screen after fair warning -> Trigger cheat-terminate...');
  const elimRes = await post('/api/rooms/cheat-terminate', {
    code: roomCode,
    name: 'Bob',
    reason: 'Left full screen after fair warning'
  });
  console.log('Elimination status:', elimRes.status, elimRes.data);
  if (elimRes.data.score !== 0) throw new Error(`Expected Bob score to be 0, got ${elimRes.data.score}`);
  if (!elimRes.data.eliminated) throw new Error('Expected eliminated to be true');

  // Test 5: Verify Bob cannot ask any more questions
  console.log('\n7. Verify eliminated Bob cannot ask any further questions...');
  const askBlocked = await post('/api/oracle/ask', { code: roomCode, name: 'Bob', question: 'Is it recursion?' });
  console.log('Blocked ask status (expected 403):', askBlocked.status, askBlocked.data);
  if (askBlocked.status !== 403) throw new Error('Expected 403 Forbidden for eliminated participant');

  // Test 6: Alice asks 1 question and remains Ongoing
  console.log('\n8. Alice asks 1 question...');
  const aliceAsk = await post('/api/oracle/ask', { code: roomCode, name: 'Alice', question: 'Is it a data structure?' });
  console.log('Alice score:', aliceAsk.data.score, 'Alice qCount:', aliceAsk.data.qCount);

  // Test 7: Verify Admin Leaderboard ranks Bob at the bottom with 0 pts
  console.log('\n9. Checking Admin Leaderboard rankings...');
  const lbRes = await get(`/api/rooms/${roomCode}/leaderboard`);
  console.log('Leaderboard entries:');
  lbRes.data.leaderboard.forEach((entry, idx) => {
    console.log(` Rank #${idx + 1}: ${entry.name} | Score: ${entry.score} pts | Status: ${entry.status} (${entry.statusDetail}) | Qs: ${entry.qCount}/${entry.maxQuestions}`);
  });

  const lb = lbRes.data.leaderboard;
  const bobEntry = lb.find(p => p.name === 'Bob');
  const aliceEntry = lb.find(p => p.name === 'Alice');

  if (!bobEntry) throw new Error('Bob not found on leaderboard');
  if (bobEntry.score !== 0) throw new Error(`Bob score must be 0, got ${bobEntry.score}`);
  if (bobEntry.status !== 'Eliminated') throw new Error('Bob status must be Eliminated');
  if (bobEntry.cheatingTerminated !== true) throw new Error('Bob cheatingTerminated must be true');

  // Bob MUST be at the bottom of the leaderboard behind Alice
  const bobRank = lb.indexOf(bobEntry);
  const aliceRank = lb.indexOf(aliceEntry);
  console.log(`Alice rank: #${aliceRank + 1} (${aliceEntry.score} pts), Bob rank: #${bobRank + 1} (${bobEntry.score} pts)`);
  if (bobRank <= aliceRank) throw new Error('Eliminated participant must rank at the bottom of the leaderboard');

  console.log('\n✅ ALL AUTOMATED TESTS PASSED SUCCESSFULLY!');
}

runTests().catch(err => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
