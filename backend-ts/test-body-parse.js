import express from 'express';

const app = express();
app.use(express.json());

app.put('/test', (req, res) => {
  console.log('req.body:', JSON.stringify(req.body));
  console.log('typeof req.body:', typeof req.body);
  console.log('!req.body:', !req.body);
  console.log('Object.keys(req.body || {}).length:', Object.keys(req.body || {}).length);
  
  const state = req.body;
  if (!state || typeof state !== "object" || Object.keys(state).length === 0) {
    res.status(400).json({ error: "No state provided" });
    return;
  }
  res.json({ status: "ok", receivedKeys: Object.keys(state) });
});

const server = app.listen(0, () => {
  const port = server.address().port;
  console.log(`Test server on port ${port}`);
  
  // Test 1: No body
  fetch(`http://localhost:${port}/test`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' }
  }).then(r => {
    console.log('\n=== Test 1: No body ===');
    console.log('Status:', r.status);
    return r.json();
  }).then(d => {
    console.log('Response:', d);
    
    // Test 2: Empty object
    return fetch(`http://localhost:${port}/test`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
  }).then(r => {
    console.log('\n=== Test 2: Empty object ===');
    console.log('Status:', r.status);
    return r.json();
  }).then(d => {
    console.log('Response:', d);
    
    // Test 3: With data
    return fetch(`http://localhost:${port}/test`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ foo: 'bar' })
    });
  }).then(r => {
    console.log('\n=== Test 3: With data ===');
    console.log('Status:', r.status);
    return r.json();
  }).then(d => {
    console.log('Response:', d);
    server.close();
  }).catch(err => {
    console.error('Error:', err);
    server.close();
  });
});
