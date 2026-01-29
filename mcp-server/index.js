/**
 * ============================================================================
 * MIGRATION: API KEY AUTHENTICATION → MANAGED IDENTITY
 * ============================================================================
 * 
 * CHANGES FROM API KEY TO MANAGED IDENTITY:
 * 
 * 1. DEPENDENCIES (package.json):
 *    - Added: @azure/identity ^4.0.0 for managed identity support
 *    - Removed: FOUNDRY_API_KEY environment variable (no longer needed)
 *
 * 2. IMPORTS:
 *    - Added: auth module exports (getAuthHeaders, makeAuthenticatedRequest)
 *    - Removed: Direct import of DefaultAzureCredential (moved to auth.js)
 *    - This enables automatic token acquisition using webapp's managed identity
 *
 * 3. QUERY ENDPOINT (/session/:sid/query):
 *    - REMOVED: const apiKey = process.env.FOUNDRY_API_KEY;
 *    - REMOVED: 'api-key': apiKey header
 *    - ADDED: getAuthHeaders() to get OAuth token
 *    - ADDED: 'Authorization': `Bearer ${token.token}` header
 *    - Benefits: No API keys in environment, automatic token refresh, secure
 *
 * 4. GITHUB ACTIONS WORKFLOW (.github/workflows/deploy.yml):
 *    - Added step: "Enable Managed Identity on Web App"
 *      - Assigns system-managed identity to Azure App Service
 *    - Added step: "Grant Web App Access to AI Foundry"
 *      - Assigns required Azure roles to the managed identity:
 *        * Azure AI User
 *        * Cognitive Services User
 *        * Cognitive Services OpenAI Contributor
 *    - REMOVED: FOUNDRY_API_KEY from app settings
 *
 * HOW IT WORKS:
 * - When code runs in Azure, DefaultAzureCredential automatically uses the
 *   webapp's managed identity to acquire an OAuth token
 * - Token is valid for 1 hour and automatically refreshed as needed
 * - No secrets stored in environment variables or key vaults
 * - Azure handles all credential management securely
 *
 * LOCAL TESTING:
 * - Set AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID for local dev
 * - Or use: az login && az account set --subscription <id>
 *
 * ============================================================================
 */

// added debugging options

//test to trigger pipeline

// require('dotenv').config();

const express = require('express');
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const { createMCPServer } = require('./mcp-handler');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const { getAuthHeaders, makeAuthenticatedRequest } = require('./auth');
// ...existing code...

const app = express();

// Configure multer for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    // Accept only txt and csv files
    const allowedTypes = ['.txt', '.csv'];
    const fileExtension = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
    if (allowedTypes.includes(fileExtension)) {
      cb(null, true);
    } else {
      cb(new Error('Only .txt and .csv files are allowed'), false);
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Serve static files from /public (index.html is our landing page)
app.use(express.static('public'));


app.use(express.json());

const sessions = {}; // In-memory store (for demo)

// Health / landing page
app.get('/', (_, res) => {
  res.type('text/plain').send('MCP server OK');
});

// (Optional) a dedicated health endpoint for probes/APIM
app.get('/healthz', (_, res) => res.json({ status: 'ok' }));

// ==================== MCP ENDPOINT ====================
// Store active MCP server connections
const mcpConnections = new Map();

// SSE endpoint for Model Context Protocol
app.get('/mcp/sse', async (req, res) => {
  console.log('🔌 MCP SSE connection initiated');
  
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  
  // Generate unique connection ID
  const connectionId = uuidv4();
  
  // Send a keep-alive comment every 30 seconds
  const keepAliveInterval = setInterval(() => {
    try {
      res.write(': keep-alive\n\n');
    } catch (e) {
      clearInterval(keepAliveInterval);
    }
  }, 30000);
  
  try {
    // Send the endpoint event with our connection ID
    const endpoint = `/mcp/message?sessionId=${connectionId}`;
    res.write(`event: endpoint\ndata: ${endpoint}\n\n`);
    console.log(`📤 Sent endpoint event: ${endpoint}`);
    
    // Create MCP server (but DON'T create transport or connect yet)
    // We'll handle messages manually in the POST endpoint
    const mcpServer = createMCPServer(sessions);
    
    // Store the connection with res for sending SSE messages
    // Don't include transport since we're not using it
    mcpConnections.set(connectionId, { server: mcpServer, res });
    console.log(`🔵 STORED connection: ${connectionId}, Total connections: ${mcpConnections.size}`);
    console.log(`🔵 All connection IDs: ${Array.from(mcpConnections.keys()).join(', ')}`);
    console.log(`✅ MCP connection ready (connection: ${connectionId})`);
    
    // Handle connection close
    res.on('close', () => {
      console.log(`🔌 MCP SSE connection closed (connection: ${connectionId})`);
      clearInterval(keepAliveInterval);
      mcpConnections.delete(connectionId);
    });
    
    res.on('error', (error) => {
      console.error('❌ MCP SSE connection error:', error);
      clearInterval(keepAliveInterval);
      mcpConnections.delete(connectionId);
    });
    
  } catch (error) {
    console.error('❌ Error connecting MCP server:', error);
    clearInterval(keepAliveInterval);
    if (!res.headersSent) {
      res.status(500).send('Failed to establish MCP connection');
    }
  }
});

app.post('/mcp/message', async (req, res) => {
  const connectionId = req.query.sessionId;
  const acceptHeader = req.headers.accept || '';
  
  const debugInfo = {
    requestedId: connectionId,
    totalConnections: mcpConnections.size,
    availableIds: Array.from(mcpConnections.keys()),
    message: req.body.method,
    accept: acceptHeader,
    allHeaders: req.headers  // Log ALL headers
  };
  
  console.log(`📨 MCP message received:`, JSON.stringify(debugInfo, null, 2));
  
  // Get the connection
  const connection = mcpConnections.get(connectionId);
  console.log(`🟡 Connection lookup result: ${connection ? 'FOUND ✅' : 'NOT FOUND ❌'}`);
  
  if (!connection) {
    console.error(`❌ No active MCP connection found for: ${connectionId}`);
    return res.status(404).json({ 
      jsonrpc: '2.0',
      error: { 
        code: -32001, 
        message: 'Connection not found',
        debug: debugInfo // Include debug info in error response
      },
      id: req.body.id
    });
  }
  
  // Check if client accepts SSE (for tools/call responses per MCP spec)
  const wantsSSE = acceptHeader.includes('text/event-stream');
  
  try {
    const message = req.body;
    
    // Handle JSON-RPC messages manually
    if (message.method === 'initialize') {
      const response = {
        jsonrpc: '2.0',
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: 'ai-foundry-mcp-gateway', version: '1.0.0' },
        },
        id: message.id,
      };
      
      // For initialize, send via SSE on the long-lived connection AND return JSON
      connection.res.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
      console.log('✅ Sent initialization response via SSE');
      
      // Also return as JSON if client wants it
      if (wantsSSE) {
        return res.status(202).send(); // Accepted, response sent via SSE
      } else {
        return res.json(response);
      }
    }
    
    if (message.method === 'tools/list') {
      // Import tool handlers from mcp-handler
      const { createMCPServer } = require('./mcp-handler');
      const tempServer = createMCPServer(sessions);
      
      // Get tool definitions
      const tools = [
        {
          name: 'create_session',
          description: 'Create a new document session',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        {
          name: 'list_documents',
          description: 'List all documents in a session',
          inputSchema: {
            type: 'object',
            properties: { sessionId: { type: 'string' } },
            required: ['sessionId'],
          },
        },
        {
          name: 'get_document',
          description: 'Get document content',
          inputSchema: {
            type: 'object',
            properties: { sessionId: { type: 'string' }, docId: { type: 'string' } },
            required: ['sessionId', 'docId'],
          },
        },
        {
          name: 'search_documents',
          description: 'Search documents',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' }, sessionId: { type: 'string' } },
            required: ['query'],
          },
        },
        {
          name: 'upload_document',
          description: 'Upload document',
          inputSchema: {
            type: 'object',
            properties: { sessionId: { type: 'string' }, title: { type: 'string' }, text: { type: 'string' } },
            required: ['sessionId', 'title', 'text'],
          },
        },
      ];
      
      const response = {
        jsonrpc: '2.0',
        result: { tools },
        id: message.id,
      };
      
      // For tools/list, send via SSE on the long-lived connection AND return JSON
      connection.res.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
      console.log('✅ Sent tools list via SSE');
      
      // Also return as JSON if client wants it
      if (wantsSSE) {
        return res.status(202).send(); // Accepted, response sent via SSE
      } else {
        return res.json(response);
      }
    }
    
    if (message.method === 'tools/call') {
      const { name, arguments: args } = message.params;
      console.log(`🔧 Executing tool: ${name}`);
      console.log(`🔧 Message ID from agent: ${message.id}`);
      console.log(`🔧 Tool arguments:`, JSON.stringify(args, null, 2));
      console.log(`🔧 Available sessions:`, Object.keys(sessions));
      console.log(`🔧 Client wants SSE:`, wantsSSE);
      
      let result;
      try {
        // Execute tool directly
        switch (name) {
          case 'create_session': {
            const sid = uuidv4();
            sessions[sid] = { docs: [], history: [] };
            console.log(`✅ New session created via MCP: ${sid}`);
            result = {
              content: [{
                type: 'text',
                text: JSON.stringify({ sessionId: sid, message: 'Session created successfully' }, null, 2),
              }],
              isError: false
            };
            break;
          }
          case 'list_documents': {
            const session = sessions[args.sessionId];
            if (!session) throw new Error(`Session not found: ${args.sessionId}`);
            result = {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  sessionId: args.sessionId,
                  documentCount: session.docs.length,
                  documents: session.docs.map(d => ({ id: d.id, title: d.title, textLength: d.text.length })),
                }, null, 2),
              }],
              isError: false
            };
            break;
          }
          case 'get_document': {
            const session = sessions[args.sessionId];
            if (!session) {
              console.error(`❌ Session not found: ${args.sessionId}`);
              console.error(`   Available sessions:`, Object.keys(sessions));
              throw new Error(`Session not found: ${args.sessionId}`);
            }
            console.log(`📄 Session found, has ${session.docs.length} documents`);
            const doc = session.docs.find(d => d.id === args.docId);
            if (!doc) {
              console.error(`❌ Document not found: ${args.docId}`);
              console.error(`   Available docs:`, session.docs.map(d => d.id));
              throw new Error(`Document not found: ${args.docId}`);
            }
            console.log(`✅ Document found: ${doc.title}`);
            result = {
              content: [{
                type: 'text',
                text: JSON.stringify({ id: doc.id, title: doc.title, text: doc.text }, null, 2),
              }],
              isError: false
            };
            break;
          }
          case 'search_documents': {
            const results = [];
            const searchLower = args.query.toLowerCase();
            const sessionsToSearch = args.sessionId ? { [args.sessionId]: sessions[args.sessionId] } : sessions;
            for (const [sid, session] of Object.entries(sessionsToSearch)) {
              if (!session) continue;
              for (const doc of session.docs) {
                if (doc.text.toLowerCase().includes(searchLower) || doc.title.toLowerCase().includes(searchLower)) {
                  const index = doc.text.toLowerCase().indexOf(searchLower);
                  results.push({ sessionId: sid, docId: doc.id, title: doc.title, snippet: `...${doc.text.substring(Math.max(0, index - 50), Math.min(doc.text.length, index + 50))}...` });
                }
              }
            }
            result = { content: [{ type: 'text', text: JSON.stringify({ query: args.query, resultCount: results.length, results }, null, 2) }], isError: false };
            break;
          }
          case 'upload_document': {
            const session = sessions[args.sessionId];
            if (!session) throw new Error(`Session not found`);
            const docId = uuidv4();
            session.docs.push({ id: docId, title: args.title, text: args.text });
            result = { content: [{ type: 'text', text: JSON.stringify({ success: true, docId, title: args.title, sessionId: args.sessionId }, null, 2) }], isError: false };
            break;
          }
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
        
        const response = { jsonrpc: '2.0', result, id: message.id };
        
        // CRITICAL FIX: Always send response back through the ORIGINAL SSE connection
        // The agent is listening on the long-lived SSE stream for tool responses
        console.log(`✅ Tool ${name} executed, sending response via original SSE connection`);
        console.log(`📤 Response being sent to agent:`);
        console.log(`   jsonrpc: ${response.jsonrpc}`);
        console.log(`   id: ${response.id}`);
        console.log(`   result.isError: ${result.isError}`);
        console.log(`   result.content[0].type: ${result.content[0].type}`);
        console.log(`   result.content[0].text length: ${result.content[0].text.length}`);
        console.log(`📤 Full response:`, JSON.stringify(response, null, 2));
        
        const sseConnection = mcpConnections.get(connectionId);
        if (sseConnection && sseConnection.res && !sseConnection.res.writableEnded) {
          try {
            sseConnection.res.write(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
            console.log(`✅ Response sent via SSE connection ${connectionId}`);
            // Send 200 OK to close the POST request
            return res.status(200).json({ acknowledged: true });
          } catch (sseError) {
            console.error(`❌ Failed to send response via SSE: ${sseError.message}`);
            // Fallback to POST response if SSE write fails
            return res.json(response);
          }
        } else {
          console.warn(`⚠️ SSE connection ${connectionId} not available or closed, falling back to POST response`);
          console.log(`   Available connections: ${Array.from(mcpConnections.keys()).join(', ')}`);
          return res.json(response);
        }
        
      } catch (toolError) {
        // Per MCP spec: Tool execution errors should be returned as results with isError: true
        const errorResult = {
          content: [{
            type: 'text',
            text: `Tool execution failed: ${toolError.message}`
          }],
          isError: true
        };
        const errorResponse = { jsonrpc: '2.0', result: errorResult, id: message.id };
        
        if (wantsSSE) {
          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          res.write(`event: message\ndata: ${JSON.stringify(errorResponse)}\n\n`);
          console.log(`❌ Tool ${name} error sent via SSE, closing stream`);
          res.end();
        } else {
          console.log(`❌ Tool ${name} error, returning JSON response`);
          return res.json(errorResponse);
        }
      }
      return; // Exit after handling tools/call
    }
    
    // Method not found
    const errorResponse = { jsonrpc: '2.0', error: { code: -32601, message: `Method not found: ${message.method}` }, id: message.id };
    
    if (wantsSSE) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.write(`event: message\ndata: ${JSON.stringify(errorResponse)}\n\n`);
      res.end();
    } else {
      connection.res.write(`event: message\ndata: ${JSON.stringify(errorResponse)}\n\n`);
      return res.json({ received: true });
    }
    
  } catch (error) {
    console.error('❌ Error handling MCP message:', error);
    res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: error.message }, id: req.body.id });
  }
});
// ==================== END MCP ENDPOINT ====================

// Debug endpoint to check sessions
app.get('/debug/sessions', (req, res) => {
  const sessionList = Object.keys(sessions).map(sid => ({
    sessionId: sid,
    documentCount: sessions[sid].docs.length,
    documents: sessions[sid].docs.map(d => ({ id: d.id, title: d.title }))
  }));
  res.json({ 
    totalSessions: sessionList.length,
    sessions: sessionList 
  });
});

app.post('/session', (req, res) => {
  const sid = uuidv4();
  sessions[sid] = { docs: [], history: [] };
  console.log(`✅ New session created: ${sid}`);
  res.json({ sessionId: sid });
});

app.post('/session/:sid/upload', (req, res) => {
  const { sid } = req.params;
  if (!sessions[sid]) return res.status(404).send('Session not found');

  const { text, title } = req.body;
  const docId = uuidv4();
  sessions[sid].docs.push({ id: docId, title, text });
  console.log(`📄 Uploaded document ${docId} to session ${sid}`);
  res.json({ docId });
});

// New endpoint for file uploads
app.post('/session/:sid/upload-file', upload.single('file'), (req, res) => {
  const { sid } = req.params;
  if (!sessions[sid]) return res.status(404).send('Session not found');

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const text = req.file.buffer.toString('utf-8');
    const title = req.body.title || req.file.originalname;
    const docId = uuidv4();
    
    sessions[sid].docs.push({ id: docId, title, text });
    console.log(`📁 Uploaded file ${req.file.originalname} (${docId}) to session ${sid}`);
    res.json({ docId, filename: req.file.originalname });
  } catch (error) {
    console.error('Error processing file:', error);
    res.status(500).json({ error: 'Failed to process file' });
  }
});

app.post('/session/:sid/query', async (req, res) => {
  const { sid } = req.params;
  if (!sessions[sid]) return res.status(404).send('Session not found');

  const { docId, query, mode } = req.body;
  const doc = sessions[sid].docs.find(d => d.id === docId);
  if (!doc) return res.status(404).send('Document not found');

  // ...existing code...

  const prompt = mode === 'qa'
    ? `Document:\n${doc.text}\n\nQuestion: ${query}\nAnswer:`
    : `Summarize the following document:\n\n${doc.text}\n\nSummary:`;

  const endpoint = process.env.FOUNDRY_ENDPOINT;

  console.log("🔹 Sending request to Azure GPT-4o-mini...");
  console.log("Endpoint:", endpoint);
  
  try {
    const authHeaders = await getAuthHeaders();
    
    const headers = {
      'Content-Type': 'application/json',
      ...authHeaders
    };

    console.log("Request body:", JSON.stringify({
      messages: [{ role: "user", content: prompt }],
      max_tokens: 300
    }, null, 2));

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        messages: [{ role: "user", content: prompt }],
        max_tokens: 300
      })
    });

    const data = await response.json();

    console.log("🔹 Raw Azure response:");
    console.log(JSON.stringify(data, null, 2));

    let assistantMessage = data?.choices?.[0]?.message?.content ||
                           data?.choices?.[0]?.content ||
                           data?.error?.message ||
                           "No response from model";

    sessions[sid].history.push({ query, response: assistantMessage });
    res.json({ answer: assistantMessage });

  } catch (err) {
    console.error("❌ Error during fetch:", err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 MCP server listening on port ${PORT}`));