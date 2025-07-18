const WebSocket = require('ws');

// Create WebSocket server
const wss = new WebSocket.Server({ port: process.env.PORT || 8080 });

// Store connected clients and waiting users
const clients = new Map(); // Maps client IDs to WebSocket objects
const waitingUsers = []; // Queue for users waiting to be paired

// Generate a unique ID for each client
function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

wss.on('connection', (ws) => {
  // Assign a unique ID to the client
  const clientId = generateId();
  clients.set(clientId, ws);

  // Send welcome message with client ID
  ws.send(JSON.stringify({ type: 'welcome', id: clientId }));
  console.log(`Client ${clientId} connected`);

  // Handle incoming messages
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      // Handle waiting users
      if (data.type === 'waiting') {
        if (waitingUsers.length > 0) {
          // Pair with another waiting user
          const partnerId = waitingUsers.shift();
          const partnerWs = clients.get(partnerId);
          if (partnerWs && partnerWs.readyState === WebSocket.OPEN) {
            // Notify both clients of pairing
            ws.send(JSON.stringify({ type: 'paired', partnerId }));
            partnerWs.send(JSON.stringify({ type: 'paired', partnerId: clientId }));
            console.log(`Paired ${clientId} with ${partnerId}`);
          } else {
            // Partner disconnected, add to waiting list
            waitingUsers.push(clientId);
          }
        } else {
          // No waiting users, add to queue
          waitingUsers.push(clientId);
          console.log(`Client ${clientId} added to waiting list`);
        }
      }

      // Handle signaling messages (offer, answer, iceCandidate)
      if (data.type === 'offer' || data.type === 'answer' || data.type === 'iceCandidate') {
        const targetId = data.to;
        const targetWs = clients.get(targetId);
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(JSON.stringify({
            type: data.type,
            from: clientId,
            payload: data.payload
          }));
          console.log(`Relayed ${data.type} from ${clientId} to ${targetId}`);
        }
      }

      // Handle text messages
      if (data.type === 'message') {
        const targetId = data.to;
        const targetWs = clients.get(targetId);
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(JSON.stringify({
            type: 'message',
            from: clientId,
            payload: data.payload
          }));
          console.log(`Relayed message from ${clientId} to ${targetId}`);
        }
      }

      // Handle end chat
      if (data.type === 'endChat') {
        const targetId = data.to;
        const targetWs = clients.get(targetId);
        if (targetWs && targetWs.readyState === WebSocket.OPEN) {
          targetWs.send(JSON.stringify({ type: 'chatEnded', from: clientId }));
          console.log(`Client ${clientId} ended chat with ${targetId}`);
        }
        // Remove from waiting list if present
        const index = waitingUsers.indexOf(clientId);
        if (index !== -1) {
          waitingUsers.splice(index, 1);
        }
      }

      // Handle ping/pong for connection health
      if (data.type === 'pong') {
        console.log(`Received pong from ${clientId}`);
      }
    } catch (e) {
      console.error(`Error processing message from ${clientId}: ${e}`);
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
    }
  });

  // Handle client disconnection
  ws.on('close', () => {
    console.log(`Client ${clientId} disconnected`);
    clients.delete(clientId);
    // Remove from waiting list
    const index = waitingUsers.indexOf(clientId);
    if (index !== -1) {
      waitingUsers.splice(index, 1);
    }
    // Notify partner if paired
    for (const [otherId, otherWs] of clients) {
      if (otherWs.partnerId === clientId && otherWs.readyState === WebSocket.OPEN) {
        otherWs.send(JSON.stringify({ type: 'disconnected', from: clientId }));
      }
    }
  });

  // Periodically send ping to keep connection alive
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    } else {
      clearInterval(pingInterval);
    }
  }, 30000);
});

console.log(`WebSocket server running on port ${process.env.PORT || 8080}`);
