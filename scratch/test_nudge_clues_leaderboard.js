const http = require('http');

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, res => {
      let resData = '';
      res.on('data', chunk => resData += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(resData) });
        } catch(e) {
          resolve({ status: res.statusCode, text: resData });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function run() {
  console.log('--- Starting Integration Test ---');

  // 1. Create Room with Beginner Category
  console.log('1. Creating room with Programming Fundamentals...');
  const createRes = await request('POST', '/api/rooms/create', {
    roomType: 'Programming Fundamentals',
    termMode: 'manual',
    manualTerm: 'Loop',
    timerSeconds: 300,
    fullScreenEnabled: true,
    warningsEnabled: true
  });
  console.log('Create Response:', createRes.data);
  const code = createRes.data.code;
  if (!code) throw new Error('Failed to create room');

  // 2. Join Participant "Alex"
  console.log('\n2. Joining participant "Alex"...');
  const joinRes = await request('POST', '/api/rooms/join', {
    code,
    name: 'Alex'
  });
  console.log('Join Response:', joinRes.data);

  // 3. Immediately Check Admin Leaderboard
  console.log('\n3. Verifying participant immediately appears on Admin Leaderboard as Ongoing...');
  const lbRes1 = await request('GET', `/api/rooms/${code}/leaderboard`);
  console.log('Leaderboard 1:', JSON.stringify(lbRes1.data, null, 2));
  const alex1 = lbRes1.data.leaderboard.find(p => p.name === 'Alex');
  if (!alex1) throw new Error('Alex not found on leaderboard!');
  if (alex1.status !== 'Ongoing') throw new Error(`Expected status Ongoing, got ${alex1.status}`);
  if (alex1.isFinished !== false) throw new Error('Expected isFinished to be false');

  // 4. Ask questions up to Q10
  console.log('\n4. Asking questions 1 through 10 to trigger progressive clue unlock...');
  let lastAsk;
  for (let i = 1; i <= 10; i++) {
    lastAsk = await request('POST', '/api/oracle/ask', {
      code,
      name: 'Alex',
      question: `Does it repeat execution step ${i}?`
    });
    console.log(`Q${i} Ask Answer:`, lastAsk.data.answer);
    if (lastAsk.data.clue) {
      console.log(`Q${i} Clue:`, lastAsk.data.clue);
    }
  }

  // Verify Clue at Q10
  if (!lastAsk.data.clue || !lastAsk.data.clue.unlocked) {
    throw new Error('Expected progressive clue to be unlocked at Q10!');
  }
  console.log('\n>>> Level 1 Clue verified:', lastAsk.data.clue.clue, '|', lastAsk.data.clue.desc);

  // 5. Ask until Q12 (Level 2)
  console.log('\n5. Asking Q11 and Q12 for Level 2 boundary clue...');
  for (let i = 11; i <= 12; i++) {
    lastAsk = await request('POST', '/api/oracle/ask', {
      code,
      name: 'Alex',
      question: `Is it an iterative control structure question ${i}?`
    });
  }
  console.log('Q12 Clue Level:', lastAsk.data.clue.level, 'Pattern:', lastAsk.data.clue.clue);
  if (lastAsk.data.clue.level !== 2) throw new Error('Expected Level 2 clue at Q12');

  // 6. Ask until Q15 (Level 3)
  console.log('\n6. Asking Q13, Q14, Q15 for Level 3 vowels and concept nudge...');
  for (let i = 13; i <= 15; i++) {
    lastAsk = await request('POST', '/api/oracle/ask', {
      code,
      name: 'Alex',
      question: `Does it use for or while question ${i}?`
    });
  }
  console.log('Q15 Clue Level:', lastAsk.data.clue.level, 'Pattern:', lastAsk.data.clue.clue, 'Hint:', lastAsk.data.clue.conceptHint);
  if (lastAsk.data.clue.level !== 3) throw new Error('Expected Level 3 clue at Q15');

  // 7. Check Leaderboard status while still ongoing
  console.log('\n7. Checking Admin Leaderboard during ongoing Q15 interrogation...');
  const lbRes2 = await request('GET', `/api/rooms/${code}/leaderboard`);
  const alex2 = lbRes2.data.leaderboard.find(p => p.name === 'Alex');
  console.log('Alex at Q15:', alex2);
  if (alex2.status !== 'Ongoing') throw new Error(`Expected status Ongoing, got ${alex2.status}`);
  if (alex2.qCount !== 15) throw new Error(`Expected qCount 15, got ${alex2.qCount}`);

  // 8. Crack the Vault
  console.log('\n8. Alex guesses the exact term "Loop"...');
  const crackRes = await request('POST', '/api/oracle/ask', {
    code,
    name: 'Alex',
    question: 'Is it Loop?'
  });
  console.log('Crack Response:', crackRes.data);
  if (!crackRes.data.solved) throw new Error('Failed to solve term');

  // 9. Verify Final Leaderboard shows Finished (Cracked) with marks
  console.log('\n9. Verifying Admin Leaderboard shows Finished (Cracked) with live marks...');
  const lbRes3 = await request('GET', `/api/rooms/${code}/leaderboard`);
  console.log('Final Leaderboard:', JSON.stringify(lbRes3.data, null, 2));
  const alex3 = lbRes3.data.leaderboard.find(p => p.name === 'Alex');
  if (alex3.status !== 'Finished') throw new Error(`Expected status Finished, got ${alex3.status}`);
  if (!alex3.statusDetail.includes('Cracked')) throw new Error(`Expected statusDetail Finished (Cracked), got ${alex3.statusDetail}`);
  if (alex3.score <= 0) throw new Error(`Expected positive score, got ${alex3.score}`);

  // 10. Persistence check: Admin query retains data even when re-queried later
  console.log('\n10. Simulating admin returning to room code page...');
  const lbRes4 = await request('GET', `/api/rooms/${code}/leaderboard`);
  if (lbRes4.data.leaderboard.length === 0) throw new Error('Leaderboard was lost!');
  console.log('Leaderboard accurately persisted for room', code);

  console.log('\nALL INTEGRATION TESTS PASSED SUCCESSFULLY! 🎉');
}

run().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
