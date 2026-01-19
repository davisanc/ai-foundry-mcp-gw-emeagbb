// Test get_document MCP tool call
const { EventSource } = require('eventsource');
const fetch = require('node-fetch');

const SESSION_ID = '9da9c4ad-13b1-4a42-88b9-b8c31d9f722c';
const DOC_ID = 'a57fc6fe-454c-4bf4-8c05-cfbe4d400557';
const WEBAPP_NAME = process.env.WEBAPP_NAME || 'mcp-server-app-emeagbb';
const BASE_URL = `https://${WEBAPP_NAME}.azurewebsites.net`;

console.log('🧪 Testing get_document MCP tool...\n');
console.log(`Session ID: ${SESSION_ID}`);
console.log(`Document ID: ${DOC_ID}`);
console.log(`Web App: ${BASE_URL}\n`);

let responseReceived = false;

const es = new EventSource(`${BASE_URL}/mcp/sse`);

es.addEventListener('endpoint', async (event) => {
  const endpoint = event.data;
  console.log('✅ SSE connected, endpoint:', endpoint);
  
  const messageUrl = `${BASE_URL}${endpoint}`;
  
  console.log('\n📤 Sending get_document request...');
  
  // Send get_document request
  const response = await fetch(messageUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'get_document',
        arguments: {
          sessionId: SESSION_ID,
          docId: DOC_ID
        }
      },
    }),
  });
  
  const result = await response.json();
  console.log('✅ POST response:', JSON.stringify(result, null, 2));
});

es.addEventListener('message', (event) => {
  responseReceived = true;
  console.log('\n✅ SSE message received!');
  console.log('Response:', event.data);
  
  try {
    const parsed = JSON.parse(event.data);
    console.log('\nParsed response:', JSON.stringify(parsed, null, 2));
    
    if (parsed.result && parsed.result.content) {
      console.log('\n🎉 Document content:');
      parsed.result.content.forEach(content => {
        if (content.type === 'text') {
          const data = JSON.parse(content.text);
          console.log(`  Title: ${data.title}`);
          console.log(`  Text preview: ${data.text.substring(0, 200)}...`);
        }
      });
    } else if (parsed.error) {
      console.error('\n❌ Error from MCP server:', parsed.error.message);
    }
  } catch (e) {
    console.error('Failed to parse response:', e.message);
  }
  
  setTimeout(() => {
    es.close();
    process.exit(parsed.error ? 1 : 0);
  }, 1000);
});

es.onerror = (error) => {
  console.error('❌ SSE error:', error);
  es.close();
  process.exit(1);
};

// Timeout
setTimeout(() => {
  if (!responseReceived) {
    console.error('\n⏱️  Timeout: No response received after 10 seconds');
    es.close();
    process.exit(1);
  }
}, 10000);
