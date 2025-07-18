const WebSocket = require('ws');
const { randomUUID } = require('crypto');

// Create WebSocket server
const wss = new WebSocket.Server({ port: process.env.PORT || 8080 });

// Store connected clients and waiting users
const clients = new Map(); // Maps client IDs to WebSocket objects
const waitingUsers = []; // Queue for users waiting to be paired

// Structured logging
const log = (message, level = 'INFO') => {
  console.log(`[${new Date().toISOString()}] ${level}: ${message}`);
};

// Generate a unique ID for each client
function generateId() {
  return randomUUID();
}

wss.on('connection', (ws) => {
  // Assign a unique ID to the client
  const clientId = generateId();
  clients.set(clientId, ws);
  ws.clientId = clientId; // Store ID on WebSocket object
  ws.partnerId = null; // Initialize partner ID

  // Send welcome message with client ID
  ws.send(JSON.stringify({ type: 'welcome', id: clientId }));
  log(`Client ${clientId} connected`);

  // Handle incoming messages
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      // Validate message structure
      if (!data.type) {
        throw new Error('Missing message type');
      }

      // Handle waiting users
      if (data.type === 'waiting') {
        if (waitingUsers.length > 0) {
          // Pair with another waiting user
          const partnerId = waitingUsers.shift();
          const partnerWs = clients.get(partnerId);
          if (partnerWs && partnerWs.readyState === WebSocket.OPEN) {
            // Store partner IDs
            ws.partnerId = partnerId;
            partnerWs.partnerId = clientId;
            // Notify both clients of pairing
            ws.send(JSON.stringify({ type: 'paired', partnerId }));
            partnerWs.send(JSON.stringify({ type: 'paired', partnerId: clientId }));
            log(`Paired ${clientId} with ${partnerId}`);
          } else {
            // Partner disconnected, add to waiting list
            waitingUsers.push(clientId);
            log(`Client ${clientId} added to waiting list (partner ${partnerId} disconnected)`);
          }
        } else {
          // No waiting users, add to queue
          waitingUsers.push(clientId);
          log(`Client ${clientId} added to waiting list`);
        }
      }

      // Handle signaling messages (offer, answer, iceCandidate)
      if (data.type === 'offer' || data.type === 'answer' || data.type === 'iceCandidate') {
        if (!data.to || !data.payload) {
          throw new Error(`Invalid ${data.type} message: missing 'to' or 'payload'`);
        }
        const targetId = data.to;
        const targetWs = clients.get(targetId);
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(JSON.stringify({
            type: data.type,
            from: clientId,
            payload: data.payload
          }));
          log(`Relayed ${data.type} from ${clientId} to ${targetId}`);
        } else {
          log(`Failed to relay ${data.type} to ${targetId}: target not found or disconnected`, 'ERROR');
        }
      }

      // Handle text messages
      if (data.type === 'message') {
        if (!data.to || !data.payload || !data.payload.text) {
          throw new Error("Invalid message: missing 'to' or 'payload.text'");
        }
        const targetId = data.to;
        const targetWs = clients.get(targetId);
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(JSON.stringify({
            type: 'message',
            from: clientId,
            payload: data.payload
          }));
          log(`Relayed message from ${clientId} to ${targetId}`);
        } else {
          log(`Failed to relay message to ${targetId}: target not found or disconnected`, 'ERROR');
        }
      }

      // Handle end chat
      if (data.type === 'endChat') {
        if (!data.to) {
          throw new Error("Invalid endChat message: missing 'to'");
        }
        const targetId = data.to;
        const targetWs = clients.get(targetId);
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(JSON.stringify({ type: 'chatEnded', from: clientId }));
          log(`Client ${clientId} ended chat with ${targetId}`);
        }
        // Remove from waiting list if present
        const index = waitingUsers.indexOf(clientId);
        if (index !== -1) {
          waitingUsers.splice(index, 1);
          log(`Removed ${clientId} from waiting list`);
        }
      }

      // Handle ping/pong for connection health
      if (data.type === 'pong') {
        log(`Received pong from ${clientId}`);
      }
    } catch (e) {
      log(`Error processing message from ${clientId}: ${e.message}`, 'ERROR');
      ws.send(JSON.stringify({ type: 'error', message: `Invalid message: ${e.message}` }));
    }
  });

  // Handle client disconnection
  ws.on('close', () => {
    log(`Client ${clientId} disconnected`);
    clients.delete(clientId);
    // Remove from waiting list
    const index = waitingUsers.indexOf(clientId);
    if (index !== -1) {
      waitingUsers.splice(index, 1);
      log(`Removed ${clientId} from waiting list`);
    }
    // Notify partner if paired
    if (ws.partnerId) {
      const partnerWs = clients.get(ws.partnerId);
      if (partnerWs && partnerWs.readyState === WebSocket.OPEN) {
        partnerWs.send(JSON.stringify({ type: 'disconnected', from: clientId }));
        partnerWs.partnerId = null;
        log(`Notified partner ${ws.partnerId} of ${clientId} disconnection`);
      }
    }
  });

  // Periodically send ping to keep connection alive
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
      log(`Sent ping to ${clientId}`);
    } else {
      clearInterval(pingInterval);
    }
  }, 30000);
});

// Periodically clean waiting queue
setInterval(() => {
  const initialLength = waitingUsers.length;
  waitingUsers = waitingUsers.filter(id => {
    const ws = clients.get(id);
    return ws && ws.readyState === WebSocket.OPEN;
  });
  if (waitingUsers.length < initialLength) {
    log(`Cleaned waiting queue: ${initialLength - waitingUsers.length} stale entries removed`);
  }
}, 60000);

log(`WebSocket server running on port ${process.env.PORT || 8080}`);
