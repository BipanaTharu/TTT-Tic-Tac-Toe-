// DOM Elements
let boxes = document.querySelectorAll(".box");
let resetBtn = document.querySelector("#reset_btn");
let newGameBtn = document.querySelector("#new_btn");
let msgContainer = document.querySelector(".msg-container");
let msg = document.querySelector("#msg");
let status = document.querySelector("#status");

// Game State
let gameMode = null;
let board = ["", "", "", "", "", "", "", "", ""];
let turn0 = true;
let gameActive = true;

// Online Variables
let peer = null;
let conn = null;
let roomCode = null;
let playerSymbol = null;
let isMyTurn = false;
let isHost = false;
let reconnectAttempts = 0;
let maxReconnectAttempts = 3;

// Player Names
let player1Name = "Player 1";
let player2Name = "Player 2";
let myName = "";
let opponentName = "";

// Win Patterns
const winPatterns = [
    [0, 1, 2], [0, 3, 6], [0, 4, 8],
    [1, 4, 7], [2, 5, 8], [2, 4, 6],
    [3, 4, 5], [6, 7, 8]
];

// IndexedDB Implementation
let db;

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('TicTacToeDB', 4);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };
        request.onupgradeneeded = (event) => {
            db = event.target.result;
            
            // Remove old stores if they exist
            const storeNames = ['rooms', 'gameState', 'history', 'roomCodes'];
            storeNames.forEach(name => {
                if (db.objectStoreNames.contains(name)) {
                    db.deleteObjectStore(name);
                }
            });
            
            // Create fresh stores
            db.createObjectStore('rooms', { keyPath: 'code' });
            db.createObjectStore('gameState', { keyPath: 'id' });
            db.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
        };
    });
}

// Save room to IndexedDB
async function saveRoomToDB(code, data) {
    try {
        if (!db) await initDB();
        const tx = db.transaction(['rooms'], 'readwrite');
        const store = tx.objectStore('rooms');
        
        return new Promise((resolve, reject) => {
            const request = store.put({
                code: code,
                peerId: data.peerId,
                hostName: data.hostName,
                isActive: true,
                created: data.created || Date.now(),
                lastActive: Date.now()
            });
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    } catch (err) {
        console.error('Save room failed:', err);
    }
}

// Get room from IndexedDB
async function getRoomFromDB(code) {
    try {
        if (!db) await initDB();
        const tx = db.transaction(['rooms'], 'readonly');
        const store = tx.objectStore('rooms');
        
        return new Promise((resolve, reject) => {
            const request = store.get(code);
            request.onsuccess = () => {
                const room = request.result;
                // Only return room if less than 24 hours old
                if (room && (Date.now() - room.created) < 24 * 60 * 60 * 1000) {
                    resolve(room);
                } else {
                    resolve(null);
                }
            };
            request.onerror = () => resolve(null);
        });
    } catch (err) {
        console.error('Get room failed:', err);
        return null;
    }
}

// Get all rooms from IndexedDB
async function getAllRoomsFromDB() {
    try {
        if (!db) await initDB();
        const tx = db.transaction(['rooms'], 'readonly');
        const store = tx.objectStore('rooms');
        
        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => {
                const rooms = request.result || [];
                // Filter out old rooms (older than 24 hours)
                const validRooms = rooms.filter(room => 
                    (Date.now() - room.created) < 24 * 60 * 60 * 1000
                );
                resolve(validRooms);
            };
            request.onerror = () => resolve([]);
        });
    } catch (err) {
        console.error('Get all rooms failed:', err);
        return [];
    }
}

// Delete room from IndexedDB
async function deleteRoomFromDB(code) {
    try {
        if (!db) await initDB();
        const tx = db.transaction(['rooms'], 'readwrite');
        const store = tx.objectStore('rooms');
        
        return new Promise((resolve, reject) => {
            const request = store.delete(code);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    } catch (err) {
        console.error('Delete room failed:', err);
    }
}

// Save game state
async function saveGameState() {
    try {
        if (!db) await initDB();
        const tx = db.transaction(['gameState'], 'readwrite');
        const store = tx.objectStore('gameState');
        
        return new Promise((resolve, reject) => {
            const request = store.put({
                id: 'current',
                board: board,
                turn0: turn0,
                gameActive: gameActive,
                gameMode: gameMode,
                roomCode: roomCode,
                playerSymbol: playerSymbol,
                isMyTurn: isMyTurn,
                isHost: isHost,
                player1Name: player1Name,
                player2Name: player2Name,
                myName: myName,
                opponentName: opponentName,
                timestamp: Date.now()
            });
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    } catch (err) {
        console.error('Save game state failed:', err);
    }
}

// Load game state
async function loadGameState() {
    try {
        if (!db) await initDB();
        const tx = db.transaction(['gameState'], 'readonly');
        const store = tx.objectStore('gameState');
        
        return new Promise((resolve, reject) => {
            const request = store.get('current');
            request.onsuccess = () => {
                const state = request.result;
                // Only load if less than 2 hours old
                if (state && (Date.now() - state.timestamp) < 2 * 60 * 60 * 1000) {
                    resolve(state);
                } else {
                    resolve(null);
                }
            };
            request.onerror = () => resolve(null);
        });
    } catch (err) {
        console.error('Load game state failed:', err);
        return null;
    }
}

// Clear game state
async function clearGameState() {
    try {
        if (!db) await initDB();
        const tx = db.transaction(['gameState'], 'readwrite');
        const store = tx.objectStore('gameState');
        
        return new Promise((resolve, reject) => {
            const request = store.delete('current');
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    } catch (err) {
        console.error('Clear game state failed:', err);
    }
}

// Initialize DB and check for restore
initDB().then(async () => {
    const state = await loadGameState();
    if (state && state.gameMode === 'online' && state.roomCode) {
        const restore = confirm(`🎮 Restore your previous game in room ${state.roomCode}?\n\n${state.isHost ? 'You were hosting' : 'You joined this room'}`);
        if (restore) {
            // Restore state
            myName = state.myName;
            roomCode = state.roomCode;
            isHost = state.isHost;
            playerSymbol = state.playerSymbol;
            opponentName = state.opponentName;
            board = state.board;
            gameActive = state.gameActive;
            isMyTurn = state.isMyTurn;
            
            // Attempt to reconnect
            if (isHost) {
                attemptReconnectAsHost();
            } else {
                attemptReconnectAsGuest();
            }
        } else {
            await clearGameState();
        }
    }
}).catch(err => console.error('DB Init failed:', err));

// Attempt to reconnect as host
async function attemptReconnectAsHost() {
    document.getElementById('modeSelection').classList.add('hide');
    document.getElementById('gameArea').classList.remove('hide');
    updateStatus("🔄 Reconnecting to your room...");
    
    gameMode = 'online';
    peer = new Peer('ttt-' + roomCode);
    
    peer.on('open', async (id) => {
        await saveRoomToDB(roomCode, {
            peerId: id,
            hostName: myName,
            created: Date.now()
        });
        
        document.getElementById('roomCodeDisplay').classList.remove('hide');
        document.getElementById('roomCodeDisplay').innerHTML = `
            <div style="font-size: 1.1em; margin-bottom: 8px;">🎮 Room Code</div>
            <div style="font-size: 1.8em; font-weight: bold; letter-spacing: 3px; color: #a23775ff;">${roomCode}</div>
            <button onclick="copyRoomCode()" style="margin-top: 12px; padding: 10px 20px; cursor: pointer;
             background: linear-gradient(135deg, #d0401bff 0%, #e25707f0 100%); color: white; border: none; border-radius: 
             10px; font-size: 1em;">📋 Copy Code</button>
            <div style="font-size: 0.95em; margin-top: 8px; color: #2d1b4e; font-weight: bold;">You are ${myName} (🥰)</div>
            <div style="font-size: 0.8em; margin-top: 5px; color: #e27c2dff;">✅ Room restored successfully!</div>
        `;
        
        // Restore board state
        boxes.forEach((box, index) => {
            if (board[index]) {
                box.innerHTML = `<span style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%;">${board[index]}</span>`;
                box.disabled = true;
            }
        });
        
        updateStatus(opponentName ? `⏳ Waiting for ${opponentName} to reconnect...` : "⏳ Waiting for opponent...");
    });
    
    peer.on('connection', (connection) => {
        conn = connection;
        setupConnection();
        updateStatus("✅ Opponent reconnected!");
        sendData({ type: 'sync', board: board, hostName: myName });
    });
    
    peer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
            updateStatus("❌ Room ID already in use. Creating new room...");
            setTimeout(() => {
                roomCode = generateRoomCode();
                attemptReconnectAsHost();
            }, 2000);
        } else {
            updateStatus("❌ Reconnection failed");
            setTimeout(() => backToModes(), 3000);
        }
    });
}

// Attempt to reconnect as guest
async function attemptReconnectAsGuest() {
    document.getElementById('modeSelection').classList.add('hide');
    document.getElementById('gameArea').classList.remove('hide');
    updateStatus("🔄 Reconnecting to room...");
    
    gameMode = 'online';
    peer = new Peer();
    
    peer.on('open', () => {
        conn = peer.connect('ttt-' + roomCode);
        
        conn.on('open', () => {
            document.getElementById('roomCodeDisplay').classList.remove('hide');
            document.getElementById('roomCodeDisplay').innerHTML = `
                <div style="font-size: 1.1em; color: #7f2667ff;">🎮 Room: <strong>${roomCode}</strong></div>
                <div style="font-size: 0.95em; margin-top: 8px; color: #921167ff; font-weight: bold;">You are ${myName} (😊)</div>
                <div style="font-size: 0.8em; margin-top: 5px; color: #a81743ff;">✅ Reconnected successfully!</div>
            `;
            
            // Restore board state
            boxes.forEach((box, index) => {
                if (board[index]) {
                    box.innerHTML = `<span style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%;">${board[index]}</span>`;
                    box.disabled = true;
                }
            });
            
            updateStatus("✅ Reconnected! Waiting for sync...");
            setupConnection();
            sendData({ type: 'join', playerName: myName });
        });
        
        conn.on('error', () => {
            updateStatus("❌ Host is offline");
            setTimeout(() => {
                const retry = confirm('Host is not online. Try again?');
                if (retry) {
                    attemptReconnectAsGuest();
                } else {
                    backToModes();
                }
            }, 2000);
        });
    });
    
    peer.on('error', () => {
        updateStatus("❌ Connection failed");
        setTimeout(() => backToModes(), 3000);
    });
}

// Confetti Animation
function createConfetti() {
    const colors = ['#f86f1fff', '#f97325ff', '#4a9d6a', '#FFD700', '#FF6B6B'];
    for (let i = 0; i < 50; i++) {
        setTimeout(() => {
            const confetti = document.createElement('div');
            confetti.className = 'confetti';
            confetti.style.left = Math.random() * 100 + 'vw';
            confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            confetti.style.animationDelay = Math.random() * 0.5 + 's';
            document.body.appendChild(confetti);
            setTimeout(() => confetti.remove(), 3000);
        }, i * 30);
    }
}

// Update Status
function updateStatus(text) {
    status.textContent = text;
}

// Offline Mode
window.startOfflineGame = function() {
    document.getElementById('modeSelection').classList.add('hide');
    document.getElementById('nameInputModal').classList.remove('hide');
};

// Submit Names for Offline Game
window.submitOfflineNames = function() {
    const p1Input = document.getElementById('player1NameInput').value.trim();
    const p2Input = document.getElementById('player2NameInput').value.trim();
    
    player1Name = p1Input || "Player 1";
    player2Name = p2Input || "Player 2";
    
    gameMode = 'offline';
    document.getElementById('nameInputModal').classList.add('hide');
    document.getElementById('gameArea').classList.remove('hide');
    updateStatus(`${player1Name} (🥰) turn`);
    resetGame();
};

// Show Online Options
window.showOnlineOptions = async function() {
    document.getElementById('modeSelection').classList.add('hide');
    document.getElementById('onlineOptions').classList.remove('hide');
    
    // Show available rooms
    await displayAvailableRooms();
};

// Display available rooms from IndexedDB
async function displayAvailableRooms() {
    const rooms = await getAllRoomsFromDB();
    const roomList = document.getElementById('availableRooms');
    
    if (!roomList) return;
    
    if (rooms.length > 0) {
        roomList.innerHTML = '<div style="margin: 15px 0; padding: 10px; background: rgba(109, 18, 18, 0.1); border-radius: 8px;">' +
            '<div style="font-size: 0.9em; color: white; margin-bottom: 10px;">📋 Recent Rooms:</div>' +
            rooms.map(room => `
                <div style="padding: 8px; margin: 5px 0; background: rgba(94, 17, 17, 0.2); border-radius: 5px; cursor: pointer;"
                     onclick="quickJoinRoom('${room.code}')">
                    <strong>${room.code}</strong> - ${room.hostName || 'Unknown Host'}
                    <div style="font-size: 0.8em;">Created ${getTimeAgo(room.created)}</div>
                </div>
            `).join('') +
            '</div>';
    } else {
        roomList.innerHTML = '';
    }
}

// Quick join room
window.quickJoinRoom = function(code) {
    document.getElementById('roomCodeInput').value = code;
};

// Get time ago string
function getTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
}

// Back to Menu
window.backToModes = async function() {
    if (conn) conn.close();
    if (peer) peer.destroy();
    conn = null;
    peer = null;
    
    await clearGameState();
    
    document.getElementById('onlineOptions').classList.add('hide');
    document.getElementById('gameArea').classList.add('hide');
    document.getElementById('nameInputModal').classList.add('hide');
    document.getElementById('onlineNameModal').classList.add('hide');
    document.getElementById('modeSelection').classList.remove('hide');
    document.getElementById('roomCodeDisplay').classList.add('hide');
    resetGame();
    gameMode = null;
    isHost = false;
    player1Name = "Player 1";
    player2Name = "Player 2";
    myName = "";
    opponentName = "";
    roomCode = null;
};

// Generate Room Code
function generateRoomCode() {
    const chars = 'ABCDEFGHIJK12345';
    return Array.from({length: 5}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// Create Online Room
window.createOnlineRoom = function() {
    document.getElementById('onlineOptions').classList.add('hide');
    document.getElementById('onlineNameModal').classList.remove('hide');
    document.getElementById('onlineNameTitle').textContent = 'Enter Your Name';
    roomCode = null; // Clear roomCode to indicate new room
};

// Join Online Room
window.joinOnlineRoom = function() {
    const inputCode = document.getElementById('roomCodeInput').value.toUpperCase().trim();
    
    if (!inputCode || inputCode.length !== 5) {
        alert('⚠️ Enter 5-character code');
        return;
    }
    
    roomCode = inputCode;
    document.getElementById('onlineOptions').classList.add('hide');
    document.getElementById('onlineNameModal').classList.remove('hide');
    document.getElementById('onlineNameTitle').textContent = 'Enter Your Name';
};

// Submit Online Name
window.submitOnlineName = function() {
    const nameInput = document.getElementById('onlinePlayerName').value.trim();
    myName = nameInput || "Player";
    
    document.getElementById('onlineNameModal').classList.add('hide');
    
    if (roomCode) {
        startJoinRoom();
    } else {
        startCreateRoom();
    }
};

// Start Creating Room
async function startCreateRoom() {
    gameMode = 'online';
    isHost = true;
    playerSymbol = "🥰";
    isMyTurn = true;
    roomCode = generateRoomCode();
    
    updateStatus("🔄 Creating room...");
    peer = new Peer('ttt-' + roomCode);
    
    peer.on('open', async (id) => {
        // Save room to IndexedDB
        await saveRoomToDB(roomCode, {
            peerId: id,
            hostName: myName,
            created: Date.now()
        });
        
        await saveGameState();
        
        document.getElementById('gameArea').classList.remove('hide');
        document.getElementById('roomCodeDisplay').classList.remove('hide');
        document.getElementById('roomCodeDisplay').innerHTML = `
            <div style="font-size: 1.1em; margin-bottom: 8px;">🎮 Room Code</div>
            <div style="font-size: 1.8em; font-weight: bold; letter-spacing: 3px; color: #be3798ff;">${roomCode}</div>
            <button onclick="copyRoomCode()" style="margin-top: 12px; padding: 10px 20px; cursor: pointer;
             background: linear-gradient(135deg, #d47e4cff 0%, #d48c43ff 100%); color: white; border: none; border-radius: 
             10px; font-size: 1em;">📋 Copy Code</button>
            <div style="font-size: 0.95em; margin-top: 8px; color: #d43dc2ff; font-weight: bold;">You are ${myName} (🥰)</div>
            <div style="font-size: 0.8em; margin-top: 5px; color: #0f0f0fff;">✅ Room saved! Keep this tab open.</div>
        `;
        updateStatus("⏳ Waiting for opponent...");
        resetGame();
    });
    
    peer.on('connection', (connection) => {
        conn = connection;
        setupConnection();
        updateStatus("✅ Opponent connected! Your turn!");
        sendData({ type: 'sync', board: board, hostName: myName });
    });
    
    peer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
            roomCode = generateRoomCode();
            setTimeout(startCreateRoom, 1000);
        } else {
            updateStatus("❌ Connection error");
        }
    });
}

// Start Joining Room
async function startJoinRoom() {
    gameMode = 'online';
    isHost = false;
    playerSymbol = "😊";
    isMyTurn = false;
    
    updateStatus("🔄 Connecting to room...");
    
    // Check if room exists in IndexedDB
    const roomData = await getRoomFromDB(roomCode);
    
    peer = new Peer();
    
    peer.on('open', () => {
        conn = peer.connect('ttt-' + roomCode);
        
        conn.on('open', async () => {
            await saveGameState();
            
            document.getElementById('gameArea').classList.remove('hide');
            document.getElementById('roomCodeDisplay').classList.remove('hide');
            document.getElementById('roomCodeDisplay').innerHTML = `
                <div style="font-size: 1.1em; color: #b04771ff;">🎮 Room: <strong>${roomCode}</strong></div>
                <div style="font-size: 0.95em; margin-top: 8px; color: #4b4eb8ff; font-weight: bold;">You are ${myName} (😊)</div>
            `;
            updateStatus("✅ Connected! Waiting...");
            setupConnection();
            sendData({ type: 'join', playerName: myName });
        });
        
        conn.on('error', () => {
            updateStatus("❌ Connection failed");
            alert('❌ Cannot connect to room. The host may be offline or the room may not exist.\n\n💡 Make sure the host has their browser tab open!');
            backToModes();
        });
    });
    
    peer.on('error', () => {
        updateStatus("❌ Room not found");
        alert('❌ Room not found!\n\nPossible reasons:\n• Invalid room code\n• Host closed their browser\n• Room expired\n\n💡 Ask the host to create a new room!');
        backToModes();
    });
}

// Copy Room Code
window.copyRoomCode = function() {
    navigator.clipboard.writeText(roomCode).then(() => {
        alert('✅ Room code copied: ' + roomCode);
    }).catch(() => {
        alert('✅ Room code: ' + roomCode);
    });
};

// Setup Connection
function setupConnection() {
    conn.on('data', async (data) => {
        if (data.type === 'join') {
            opponentName = data.playerName || "Opponent";
            updateStatus(`✅ ${opponentName} joined! Your turn!`);
            await saveGameState();
        } else if (data.type === 'sync') {
            board = [...data.board];
            opponentName = data.hostName || "Opponent";
            boxes.forEach((box, index) => {
                if (board[index]) {
                    box.innerHTML = `<span style="display: flex; align-items: center;
                     justify-content: center; width: 100%; height: 100%;">${board[index]}</span>`;
                    box.disabled = true;
                } else {
                    box.innerHTML = "";
                    box.disabled = false;
                }
            });
            await saveGameState();
        } else if (data.type === 'move') {
            board[data.index] = data.symbol;
            boxes[data.index].innerHTML = `<span style="display: flex; align-items: center;
             justify-content: center; width: 100%; height: 100%;">${data.symbol}</span>`;
            boxes[data.index].disabled = true;
            isMyTurn = true;
            checkWinner();
            if (gameActive) updateStatus("✅ Your turn!");
            await saveGameState();
        } else if (data.type === 'reset') {
            resetGame();
            isMyTurn = isHost;
            updateStatus(isHost ? "Your turn!" : "Waiting...");
            await saveGameState();
        }
    });
    
    conn.on('close', () => {
        updateStatus("❌ Opponent disconnected");
        gameActive = false;
        boxes.forEach(box => box.disabled = true);
    });
}

// Send Data
function sendData(data) {
    if (conn && conn.open) conn.send(data);
}

// Make Move
async function makeMove(index) {
    if (gameMode === 'online') {
        if (!isMyTurn || !gameActive || board[index] !== "") return;
        
        board[index] = playerSymbol;
        boxes[index].innerHTML = `<span style="display: flex; align-items: center;
         justify-content: center; width: 100%; height: 100%;">${playerSymbol}</span>`;
        boxes[index].disabled = true;
        isMyTurn = false;
        
        sendData({ type: 'move', index: index, symbol: playerSymbol });
        checkWinner();
        if (gameActive) updateStatus(`⏳ ${opponentName}'s turn...`);
        await saveGameState();
    } else {
        const symbol = turn0 ? "🥰" : "😊";
        boxes[index].innerHTML = `<span style="display: flex; align-items: center; 
        justify-content: center; width: 100%; height: 100%;">${symbol}</span>`;
        board[index] = symbol;
        boxes[index].disabled = true;
        turn0 = !turn0;
        updateStatus(turn0 ? `${player1Name} (🥰) turn` : `${player2Name} (😊) turn`);
        checkWinner();
    }
}

// Check Winner
function checkWinner() {
    for (let pattern of winPatterns) {
        let [pos1, pos2, pos3] = [board[pattern[0]], board[pattern[1]], board[pattern[2]]];
        if (pos1 && pos1 === pos2 && pos2 === pos3) {
            if (gameMode === 'online') {
                const youWon = pos1 === playerSymbol;
                const winnerName = youWon ? myName : opponentName;
                
                if (youWon) {
                    msg.innerHTML = `
                        <div style="font-size: 2em; margin-bottom: 15px;">🎉</div>
                        <div style="font-size: 1.2em; font-weight: bold; margin-bottom: 10px;">YOU WON!</div>
                        <div style="font-size: 1.5em; margin-bottom: 5px;">${pos1}</div>
                        <div style="font-size: 0.9em; color: #d14e8dff;">${winnerName} Victory!</div>
                    `;
                    createConfetti();
                } else {
                    msg.innerHTML = `
                        <div style="font-size: 2em; margin-bottom: 15px;">😔</div>
                        <div style="font-size: 1.2em; font-weight: bold; margin-bottom: 10px;">YOU LOST!</div>
                        <div style="font-size: 1.5em; margin-bottom: 5px;">${pos1}</div>
                        <div style="font-size: 0.9em; color: #448dbeff;">${winnerName} Wins!</div>
                    `;
                }
            } else {
                const winnerName = pos1 === "🥰" ? player1Name : player2Name;
                msg.innerHTML = `
                    <div style="font-size: 2em; margin-bottom: 15px;">🎉</div>
                    <div style="font-size: 1.2em; font-weight:<parameter name="content"> bold; margin-bottom: 10px;">WINNER!</div>
<div style="font-size: 1.5em; margin-bottom: 5px;">${pos1}</div>
<div style="font-size: 0.9em; color: #b14472ff;">${winnerName} Wins!</div>
`;
createConfetti();
}
msgContainer.classList.remove("hide");
gameActive = false;
boxes.forEach(box => box.disabled = true);
return;
}
}
if (board.every(cell => cell !== "")) {
    msg.innerHTML = `
        <div style="font-size: 2em; margin-bottom: 15px;">🤝</div>
        <div style="font-size: 1.2em; font-weight: bold; margin-bottom: 10px;">IT'S A DRAW!</div>
        <div style="font-size: 0.9em; color: #b93faeff;">No Winner</div>
    `;
    msgContainer.classList.remove("hide");
    gameActive = false;
    boxes.forEach(box => box.disabled = true);}
}
// Reset Game
function resetGame() {
turn0 = true;
gameActive = true;
board = ["", "", "", "", "", "", "", "", ""];
boxes.forEach(box => {
    box.disabled = false;
    box.innerHTML = "";
});

msgContainer.classList.add("hide");
if (gameMode === 'online') {
    sendData({ type: 'reset' });
    isMyTurn = isHost;
    updateStatus(isHost ? "Your turn!" : "Waiting...");
} else if (gameMode === 'offline') {
    updateStatus(`${player1Name} (🥰) turn`);
}
}
// Event Listeners
boxes.forEach((box, index) => {
box.addEventListener("click", () => {
if (box.innerHTML === "" && gameActive) makeMove(index);
});
});
resetBtn.addEventListener("click", resetGame);
newGameBtn.addEventListener("click", () => {
msgContainer.classList.add("hide");
resetGame();
});
// Save game state periodically
setInterval(() => {
if (gameMode === 'online' && gameActive) {
saveGameState();}
}, 30000); // Every 30 seconds
// Cleanup on page unload
window.addEventListener('beforeunload', () => {
if (gameMode === 'online') {
saveGameState();
}
if (conn) conn.close();
if (peer) peer.destroy();
});