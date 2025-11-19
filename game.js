const WebSocket = require('ws');
const http = require('http');
const { v4: uuidv4 } = require('uuid');

// 游戏房间
const rooms = new Map();

// 创建一副牌
function createDeck() {
    const suits = ['♠', '♥', '♦', '♣'];
    const values = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
    
    const deck = [];
    
    // 添加普通牌
    for (let suit of suits) {
        for (let value of values) {
            deck.push({
                suit: suit,
                value: value,
                color: (suit === '♥' || suit === '♦') ? 'red' : 'black',
                id: `${value}${suit}`
            });
        }
    }
    
    // 添加大小王
    deck.push({
        suit: '★',
        value: 'Joker',
        color: 'red',
        id: 'Joker1',
        isJoker: true
    });
    
    deck.push({
        suit: '★',
        value: 'Joker',
        color: 'black',
        id: 'Joker2',
        isJoker: true
    });
    
    return deck;
}

// 洗牌
function shuffleDeck(deck) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

// 发牌
function dealCards(room) {
    const deck = shuffleDeck(createDeck());
    room.drawPile = deck;
    room.discardPile = [];
    
    // 为每个玩家发牌
    room.players.forEach(player => {
        player.hand = [];
        const cardCount = player.id === room.dealer ? 6 : 5;
        for (let i = 0; i < cardCount; i++) {
            if (room.drawPile.length > 0) {
                const card = room.drawPile.pop();
                player.hand.push(card);
            }
        }
        player.cards = player.hand.length;
    });
}

// 验证出牌
function validatePlay(cards, lastPlay) {
    // 简化验证逻辑，实际游戏中需要完整实现
    if (!lastPlay) {
        return { valid: true, type: 'any' };
    }
    
    // 检查是否为炸弹
    if (isBomb(cards)) {
        return { valid: true, type: 'bomb' };
    }
    
    // 非炸弹牌必须与上家出牌数量相同
    if (cards.length !== lastPlay.cards.length) {
        return { valid: false, message: "出牌数量必须与上家相同" };
    }
    
    return { valid: true, type: 'normal' };
}

// 检查是否为炸弹
function isBomb(cards) {
    // 简化炸弹检查
    if (cards.length === 3 || cards.length === 4) {
        const firstValue = cards[0].value;
        return cards.every(c => c.value === firstValue || c.isJoker);
    }
    return false;
}

// 广播消息给房间内所有玩家
function broadcastToRoom(roomId, message) {
    const room = rooms.get(roomId);
    if (room) {
        room.players.forEach(player => {
            if (player.socket && player.socket.readyState === WebSocket.OPEN) {
                player.socket.send(JSON.stringify(message));
            }
        });
    }
}

// 在 Railway 中我们需要创建一个 HTTP 服务器
const server = http.createServer((req, res) => {
    // 设置 CORS 头 - 加强配置
    const allowedOrigins = process.env.NODE_ENV === 'production' 
        ? ['https://your-app-name.railway.app'] 
        : ['http://localhost:3000', 'http://127.0.0.1:3000'];
    
    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    
    // 健康检查端点
    if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            status: 'ok', 
            rooms: rooms.size,
            timestamp: new Date().toISOString()
        }));
        return;
    }
    
    // 房间信息端点
    if (req.url === '/rooms' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        const roomInfo = Array.from(rooms.entries()).map(([id, room]) => ({
            id: id,
            playerCount: room.players.length,
            gameStarted: room.gameStarted
        }));
        res.end(JSON.stringify(roomInfo));
        return;
    }
    
    // API 根端点
    if (req.url === '/api' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            message: '干瞪眼儿游戏服务器',
            version: '1.0.0',
            websocket: '支持 WebSocket 连接',
            endpoints: ['/health', '/rooms', '/api']
        }));
        return;
    }
    
    // 默认响应
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ 
        message: '干瞪眼儿游戏服务器',
        version: '1.0.0',
        websocket: '支持 WebSocket 连接'
    }));
});

const wss = new WebSocket.Server({ 
    server,
    // 在 Railway 上需要处理 WebSocket 升级
    handleProtocols: (protocols, request) => {
        return 'chat';
    }
});

// WebSocket连接处理
wss.on('connection', (ws, request) => {
    console.log('新的客户端连接');
    
    // 加强 CORS 检查
    const origin = request.headers.origin;
    const allowedOrigins = process.env.NODE_ENV === 'production' 
        ? ['https://your-app-name.railway.app'] 
        : ['http://localhost:3000', 'http://127.0.0.1:3000'];
    
    if (!allowedOrigins.includes(origin)) {
        console.log('拒绝来自不允许的来源的连接:', origin);
        ws.close();
        return;
    }
    
    let currentPlayer = null;
    let currentRoom = null;
    
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            handleClientMessage(ws, message);
        } catch (error) {
            console.error('解析消息错误:', error);
            ws.send(JSON.stringify({ type: 'error', message: '无效的消息格式' }));
        }
    });
    
    ws.on('close', () => {
        console.log('客户端断开连接');
        if (currentPlayer && currentRoom) {
            // 玩家离开房间
            handlePlayerLeave(currentRoom, currentPlayer);
        }
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket 错误:', error);
    });
    
    // 处理客户端消息
    function handleClientMessage(ws, message) {
        switch (message.type) {
            case 'create_room':
                handleCreateRoom(ws, message);
                break;
            case 'join_room':
                handleJoinRoom(ws, message);
                break;
            case 'leave_room':
                handleLeaveRoom(ws, message);
                break;
            case 'start_game':
                handleStartGame(ws, message);
                break;
            case 'play_cards':
                handlePlayCards(ws, message);
                break;
            case 'pass_turn':
                handlePassTurn(ws, message);
                break;
            case 'play_again':
                handlePlayAgain(ws, message);
                break;
            default:
                ws.send(JSON.stringify({ type: 'error', message: '未知的消息类型' }));
        }
    }
    
    // 创建房间
    function handleCreateRoom(ws, message) {
        const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
        const playerId = uuidv4();
        
        const player = {
            id: playerId,
            name: message.playerName || '玩家' + playerId.slice(0, 4),
            socket: ws,
            hand: [],
            cards: 0
        };
        
        const room = {
            id: roomId,
            players: [player],
            dealer: playerId,
            currentPlayer: playerId,
            gameStarted: false,
            drawPile: [],
            discardPile: [],
            currentPlay: null,
            lastPlay: null
        };
        
        rooms.set(roomId, room);
        currentPlayer = player;
        currentRoom = room;
        
        ws.send(JSON.stringify({
            type: 'room_created',
            roomId: roomId,
            playerId: playerId
        }));
        
        console.log(`房间创建: ${roomId}, 玩家: ${player.name}`);
    }
    
    // 加入房间
    function handleJoinRoom(ws, message) {
        const room = rooms.get(message.roomId);
        if (!room) {
            ws.send(JSON.stringify({ type: 'error', message: '房间不存在' }));
            return;
        }
        
        if (room.players.length >= 6) {
            ws.send(JSON.stringify({ type: 'error', message: '房间已满' }));
            return;
        }
        
        if (room.gameStarted) {
            ws.send(JSON.stringify({ type: 'error', message: '游戏已开始，无法加入' }));
            return;
        }
        
        const playerId = uuidv4();
        const player = {
            id: playerId,
            name: message.playerName || '玩家' + playerId.slice(0, 4),
            socket: ws,
            hand: [],
            cards: 0
        };
        
        room.players.push(player);
        currentPlayer = player;
        currentRoom = room;
        
        // 通知新玩家
        ws.send(JSON.stringify({
            type: 'room_joined',
            roomId: room.id,
            playerId: playerId,
            players: room.players.map(p => ({ id: p.id, name: p.name, cards: p.cards }))
        }));
        
        // 通知其他玩家
        broadcastToRoom(room.id, {
            type: 'player_joined',
            playerId: playerId,
            playerName: player.name,
            players: room.players.map(p => ({ id: p.id, name: p.name, cards: p.cards }))
        });
        
        console.log(`玩家 ${player.name} 加入房间: ${room.id}`);
    }
    
    // 离开房间
    function handleLeaveRoom(ws, message) {
        if (!currentRoom || !currentPlayer) return;
        
        handlePlayerLeave(currentRoom, currentPlayer);
        currentPlayer = null;
        currentRoom = null;
    }
    
    // 处理玩家离开
    function handlePlayerLeave(room, player) {
        const playerIndex = room.players.findIndex(p => p.id === player.id);
        if (playerIndex !== -1) {
            room.players.splice(playerIndex, 1);
            
            // 通知其他玩家
            broadcastToRoom(room.id, {
                type: 'player_left',
                playerId: player.id,
                playerName: player.name,
                players: room.players.map(p => ({ id: p.id, name: p.name, cards: p.cards }))
            });
            
            console.log(`玩家 ${player.name} 离开房间: ${room.id}`);
            
            // 如果房间为空，删除房间
            if (room.players.length === 0) {
                rooms.delete(room.id);
                console.log(`房间 ${room.id} 已删除`);
            } else if (room.gameStarted) {
                // 如果游戏进行中且有玩家离开，结束游戏
                broadcastToRoom(room.id, {
                    type: 'game_ended',
                    reason: '玩家离开游戏',
                    winnerId: null
                });
                room.gameStarted = false;
            }
        }
    }
    
    // 开始游戏
    function handleStartGame(ws, message) {
        if (!currentRoom || !currentPlayer) return;
        
        if (currentRoom.players.length < 2) {
            ws.send(JSON.stringify({ type: 'error', message: '至少需要2名玩家才能开始游戏' }));
            return;
        }
        
        currentRoom.gameStarted = true;
        dealCards(currentRoom);
        
        // 通知所有玩家游戏开始
        broadcastToRoom(currentRoom.id, {
            type: 'game_started',
            dealer: currentRoom.dealer,
            currentPlayer: currentRoom.currentPlayer,
            playerHand: currentPlayer.hand
        });
        
        console.log(`房间 ${currentRoom.id} 游戏开始`);
    }
    
    // 出牌
    function handlePlayCards(ws, message) {
        if (!currentRoom || !currentPlayer) return;
        
        if (currentRoom.currentPlayer !== currentPlayer.id) {
            ws.send(JSON.stringify({ type: 'error', message: '现在不是你的回合' }));
            return;
        }
        
        // 验证出牌
        const validation = validatePlay(message.cards, currentRoom.lastPlay);
        if (!validation.valid) {
            ws.send(JSON.stringify({ type: 'error', message: validation.message }));
            return;
        }
        
        // 从玩家手牌中移除出的牌
        message.cards.forEach(card => {
            const cardIndex = currentPlayer.hand.findIndex(c => c.id === card.id);
            if (cardIndex !== -1) {
                currentPlayer.hand.splice(cardIndex, 1);
            }
        });
        
        currentPlayer.cards = currentPlayer.hand.length;
        
        // 更新游戏状态
        const play = {
            playerId: currentPlayer.id,
            cards: message.cards,
            type: validation.type
        };
        
        currentRoom.currentPlay = play;
        currentRoom.lastPlay = play;
        
        // 切换到下一个玩家
        const currentIndex = currentRoom.players.findIndex(p => p.id === currentPlayer.id);
        const nextIndex = (currentIndex + 1) % currentRoom.players.length;
        currentRoom.currentPlayer = currentRoom.players[nextIndex].id;
        
        // 通知所有玩家
        broadcastToRoom(currentRoom.id, {
            type: 'card_played',
            playerId: currentPlayer.id,
            playerName: currentPlayer.name,
            play: play,
            nextPlayer: currentRoom.currentPlayer,
            newHandCount: currentPlayer.cards
        });
        
        // 检查游戏是否结束
        if (currentPlayer.cards === 0) {
            endGame(currentRoom, currentPlayer);
        }
    }
    
    // 不出牌
    function handlePassTurn(ws, message) {
        if (!currentRoom || !currentPlayer) return;
        
        if (currentRoom.currentPlayer !== currentPlayer.id) {
            ws.send(JSON.stringify({ type: 'error', message: '现在不是你的回合' }));
            return;
        }
        
        // 切换到下一个玩家
        const currentIndex = currentRoom.players.findIndex(p => p.id === currentPlayer.id);
        const nextIndex = (currentIndex + 1) % currentRoom.players.length;
        currentRoom.currentPlayer = currentRoom.players[nextIndex].id;
        
        // 通知所有玩家
        broadcastToRoom(currentRoom.id, {
            type: 'turn_passed',
            playerId: currentPlayer.id,
            playerName: currentPlayer.name,
            nextPlayer: currentRoom.currentPlayer
        });
    }
    
    // 再玩一次
    function handlePlayAgain(ws, message) {
        if (!currentRoom || !currentPlayer) return;
        
        // 重置游戏状态
        currentRoom.gameStarted = false;
        currentRoom.currentPlay = null;
        currentRoom.lastPlay = null;
        
        // 开始新游戏
        handleStartGame(ws, message);
    }
    
    // 结束游戏
    function endGame(room, winner) {
        let specialResult = null;
        
        // 检查特殊胜利条件
        if (winner.id === room.dealer && room.players.every(p => p.id === room.dealer || p.cards === 5)) {
            specialResult = '天胡';
        }
        
        // 通知所有玩家游戏结束
        broadcastToRoom(room.id, {
            type: 'game_ended',
            winnerId: winner.id,
            winnerName: winner.name,
            specialResult: specialResult
        });
        
        console.log(`房间 ${room.id} 游戏结束，获胜者: ${winner.name}`);
    }
});

// 启动服务器
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`纸牌游戏服务器运行在端口 ${PORT}`);
    console.log(`环境: ${process.env.NODE_ENV || 'development'}`);
});

// 导出服务器实例（Railway 需要）
module.exports = server;