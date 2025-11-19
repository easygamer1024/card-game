const { v4: uuidv4 } = require('uuid');

// 内存存储
const rooms = new Map();
const clients = new Map();

// 创建一副牌
function createDeck() {
    const suits = ['♠', '♥', '♦', '♣'];
    const values = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
    
    const deck = [];
    
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
    if (!lastPlay) {
        return { valid: true, type: 'any' };
    }
    
    if (isBomb(cards)) {
        return { valid: true, type: 'bomb' };
    }
    
    if (cards.length !== lastPlay.cards.length) {
        return { valid: false, message: "出牌数量必须与上家相同" };
    }
    
    return { valid: true, type: 'normal' };
}

// 检查是否为炸弹
function isBomb(cards) {
    if (cards.length === 3 || cards.length === 4) {
        const firstValue = cards[0].value;
        return cards.every(c => c.value === firstValue || c.isJoker);
    }
    return false;
}

// 清理过期数据
function cleanupExpiredData() {
    const now = Date.now();
    
    // 清理过期的客户端（5分钟无活动）
    for (let [clientId, client] of clients.entries()) {
        if (now - client.lastSeen > 300000) {
            clients.delete(clientId);
        }
    }
    
    // 清理空房间和长时间无活动的房间（10分钟）
    for (let [roomId, room] of rooms.entries()) {
        if (room.players.length === 0 || (now - room.createdAt > 600000 && !room.gameStarted)) {
            rooms.delete(roomId);
        }
    }
}

// 主处理函数
module.exports = async (req, res) => {
    // 设置 CORS 头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    
    const { method, url } = req;
    const path = url.split('?')[0];
    
    try {
        // 健康检查端点
        if (path === '/health' && method === 'GET') {
            res.json({ 
                status: 'ok', 
                rooms: rooms.size,
                clients: clients.size,
                timestamp: new Date().toISOString()
            });
            return;
        }
        
        // 房间信息端点
        if (path === '/rooms' && method === 'GET') {
            const roomInfo = Array.from(rooms.entries()).map(([id, room]) => ({
                id: id,
                playerCount: room.players.length,
                gameStarted: room.gameStarted,
                players: room.players.map(p => p.name)
            }));
            res.json(roomInfo);
            return;
        }
        
        // 游戏API端点
        if (path === '/api/game') {
            let body = {};
            
            if (method === 'POST') {
                // 解析请求体
                body = await new Promise((resolve, reject) => {
                    let data = '';
                    req.on('data', chunk => data += chunk);
                    req.on('end', () => {
                        try {
                            resolve(data ? JSON.parse(data) : {});
                        } catch (e) {
                            reject(new Error('无效的JSON数据'));
                        }
                    });
                });
            } else if (method === 'GET') {
                // 处理 GET 请求（用于轮询）
                const urlParams = new URLSearchParams(url.split('?')[1]);
                body = {
                    action: 'get_updates',
                    clientId: urlParams.get('clientId'),
                    roomId: urlParams.get('roomId'),
                    playerId: urlParams.get('playerId')
                };
            } else {
                res.status(405).json({ error: '方法不允许' });
                return;
            }
            
            const { action, clientId, roomId, playerId, ...data } = body;
            
            // 验证客户端
            if (clientId) {
                if (!clients.has(clientId)) {
                    clients.set(clientId, {
                        id: clientId,
                        lastSeen: Date.now(),
                        pendingMessages: []
                    });
                } else {
                    clients.get(clientId).lastSeen = Date.now();
                }
            }
            
            let result;
            
            switch (action) {
                case 'create_room':
                    result = handleCreateRoom(data.playerName, clientId);
                    break;
                case 'join_room':
                    result = handleJoinRoom(data.roomId, data.playerName, clientId);
                    break;
                case 'leave_room':
                    result = handleLeaveRoom(roomId, playerId, clientId);
                    break;
                case 'start_game':
                    result = handleStartGame(roomId, playerId);
                    break;
                case 'play_cards':
                    result = handlePlayCards(roomId, playerId, data.cards);
                    break;
                case 'pass_turn':
                    result = handlePassTurn(roomId, playerId);
                    break;
                case 'get_updates':
                    result = handleGetUpdates(roomId, playerId, clientId);
                    break;
                default:
                    res.status(400).json({ error: '未知的操作', action: action });
                    return;
            }
            
            // 清理过期数据
            cleanupExpiredData();
            
            res.json(result);
            return;
        }
        
        // 默认响应
        res.json({ 
            message: '干瞪眼儿游戏服务器 API',
            endpoints: ['/health', '/rooms', '/api/game'],
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('服务器错误:', error);
        res.status(500).json({ 
            error: '服务器内部错误',
            message: error.message 
        });
    }
};

// 创建房间
function handleCreateRoom(playerName, clientId) {
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const playerId = uuidv4();
    
    const player = {
        id: playerId,
        name: playerName || '玩家' + playerId.slice(0, 4),
        hand: [],
        cards: 0,
        pendingMessages: []
    };
    
    const room = {
        id: roomId,
        players: [player],
        dealer: playerId,
        currentPlayer: null, // 修复：游戏开始前没有当前玩家
        gameStarted: false,
        drawPile: [],
        discardPile: [],
        currentPlay: null,
        lastPlay: null,
        createdAt: Date.now()
    };
    
    rooms.set(roomId, room);
    
    if (clientId) {
        const client = clients.get(clientId);
        if (client) {
            client.roomId = roomId;
            client.playerId = playerId;
        }
    }
    
    return {
        success: true,
        type: 'room_created',
        roomId: roomId,
        playerId: playerId
    };
}

// 加入房间
function handleJoinRoom(roomId, playerName, clientId) {
    const room = rooms.get(roomId);
    if (!room) {
        return { success: false, error: '房间不存在' };
    }
    
    if (room.players.length >= 6) {
        return { success: false, error: '房间已满' };
    }
    
    if (room.gameStarted) {
        return { success: false, error: '游戏已开始，无法加入' };
    }
    
    const playerId = uuidv4();
    const player = {
        id: playerId,
        name: playerName || '玩家' + playerId.slice(0, 4),
        hand: [],
        cards: 0,
        pendingMessages: []
    };
    
    room.players.push(player);
    
    if (clientId) {
        const client = clients.get(clientId);
        if (client) {
            client.roomId = roomId;
            client.playerId = playerId;
        }
    }
    
    // 通知其他玩家
    room.players.forEach(p => {
        if (p.id !== playerId) {
            p.pendingMessages.push({
                type: 'player_joined',
                playerId: playerId,
                playerName: player.name,
                players: room.players.map(pl => ({ 
                    id: pl.id, 
                    name: pl.name, 
                    cards: pl.cards 
                }))
            });
        }
    });
    
    return {
        success: true,
        type: 'room_joined',
        roomId: roomId,
        playerId: playerId,
        players: room.players.map(p => ({ 
            id: p.id, 
            name: p.name, 
            cards: p.cards 
        }))
    };
}

// 离开房间
function handleLeaveRoom(roomId, playerId, clientId) {
    const room = rooms.get(roomId);
    if (!room) {
        return { success: false, error: '房间不存在' };
    }
    
    const playerIndex = room.players.findIndex(p => p.id === playerId);
    if (playerIndex !== -1) {
        const playerName = room.players[playerIndex].name;
        room.players.splice(playerIndex, 1);
        
        // 通知其他玩家
        room.players.forEach(p => {
            p.pendingMessages.push({
                type: 'player_left',
                playerId: playerId,
                playerName: playerName,
                players: room.players.map(pl => ({ 
                    id: pl.id, 
                    name: pl.name, 
                    cards: pl.cards 
                }))
            });
        });
        
        if (room.players.length === 0) {
            rooms.delete(roomId);
        }
    }
    
    if (clientId) {
        const client = clients.get(clientId);
        if (client) {
            client.roomId = null;
            client.playerId = null;
        }
    }
    
    return { success: true, type: 'left_room' };
}

// 开始游戏
function handleStartGame(roomId, playerId) {
    const room = rooms.get(roomId);
    if (!room) {
        return { success: false, error: '房间不存在' };
    }
    
    if (room.players.length < 2) {
        return { success: false, error: '至少需要2名玩家才能开始游戏' };
    }
    
    room.gameStarted = true;
    room.currentPlayer = room.dealer; // 修复：游戏开始时设置当前玩家为庄家
    dealCards(room);
    
    // 通知所有玩家游戏开始
    room.players.forEach(player => {
        player.pendingMessages.push({
            type: 'game_started',
            dealer: room.dealer,
            currentPlayer: room.currentPlayer
        });
        
        // 为每个玩家发送手牌
        player.pendingMessages.push({
            type: 'player_hand',
            hand: player.hand
        });
    });
    
    return { success: true, type: 'game_started' };
}

// 出牌
function handlePlayCards(roomId, playerId, cards) {
    const room = rooms.get(roomId);
    if (!room) {
        return { success: false, error: '房间不存在' };
    }
    
    if (!room.gameStarted) {
        return { success: false, error: '游戏尚未开始' };
    }
    
    if (room.currentPlayer !== playerId) {
        return { success: false, error: '现在不是你的回合' };
    }
    
    const player = room.players.find(p => p.id === playerId);
    if (!player) {
        return { success: false, error: '玩家不存在' };
    }
    
    // 验证出牌
    const validation = validatePlay(cards, room.lastPlay);
    if (!validation.valid) {
        return { success: false, error: validation.message };
    }
    
    // 从玩家手牌中移除出的牌
    cards.forEach(card => {
        const cardIndex = player.hand.findIndex(c => c.id === card.id);
        if (cardIndex !== -1) {
            player.hand.splice(cardIndex, 1);
        }
    });
    
    player.cards = player.hand.length;
    
    // 更新游戏状态
    const play = {
        playerId: playerId,
        cards: cards,
        type: validation.type
    };
    
    room.currentPlay = play;
    room.lastPlay = play;
    
    // 切换到下一个玩家
    const currentIndex = room.players.findIndex(p => p.id === playerId);
    const nextIndex = (currentIndex + 1) % room.players.length;
    room.currentPlayer = room.players[nextIndex].id;
    
    // 通知所有玩家
    room.players.forEach(p => {
        p.pendingMessages.push({
            type: 'card_played',
            playerId: playerId,
            playerName: player.name,
            play: play,
            nextPlayer: room.currentPlayer,
            newHandCount: player.cards
        });
    });
    
    // 检查游戏是否结束
    if (player.cards === 0) {
        endGame(room, player);
    }
    
    return { success: true, type: 'cards_played' };
}

// 不出牌
function handlePassTurn(roomId, playerId) {
    const room = rooms.get(roomId);
    if (!room) {
        return { success: false, error: '房间不存在' };
    }
    
    if (!room.gameStarted) {
        return { success: false, error: '游戏尚未开始' };
    }
    
    if (room.currentPlayer !== playerId) {
        return { success: false, error: '现在不是你的回合' };
    }
    
    const player = room.players.find(p => p.id === playerId);
    
    // 切换到下一个玩家
    const currentIndex = room.players.findIndex(p => p.id === playerId);
    const nextIndex = (currentIndex + 1) % room.players.length;
    room.currentPlayer = room.players[nextIndex].id;
    
    // 通知所有玩家
    room.players.forEach(p => {
        p.pendingMessages.push({
            type: 'turn_passed',
            playerId: playerId,
            playerName: player.name,
            nextPlayer: room.currentPlayer
        });
    });
    
    return { success: true, type: 'turn_passed' };
}

// 获取更新
function handleGetUpdates(roomId, playerId, clientId) {
    const room = rooms.get(roomId);
    if (!room) {
        return { success: false, error: '房间不存在' };
    }
    
    const player = room.players.find(p => p.id === playerId);
    if (!player) {
        return { success: false, error: '玩家不存在' };
    }
    
    const messages = player.pendingMessages || [];
    player.pendingMessages = [];
    
    if (clientId) {
        const client = clients.get(clientId);
        if (client) {
            client.lastSeen = Date.now();
        }
    }
    
    return {
        success: true,
        type: 'updates',
        messages: messages,
        roomState: {
            players: room.players.map(p => ({ 
                id: p.id, 
                name: p.name, 
                cards: p.cards,
                isCurrent: p.id === room.currentPlayer
            })),
            currentPlayer: room.currentPlayer,
            gameStarted: room.gameStarted,
            lastPlay: room.lastPlay
        }
    };
}

// 结束游戏
function endGame(room, winner) {
    let specialResult = null;
    
    // 检查特殊胜利条件
    if (winner.id === room.dealer && room.players.every(p => p.id === room.dealer || p.cards === 5)) {
        specialResult = '天胡';
    }
    
    // 通知所有玩家游戏结束
    room.players.forEach(p => {
        p.pendingMessages.push({
            type: 'game_ended',
            winnerId: winner.id,
            winnerName: winner.name,
            specialResult: specialResult
        });
    });
    
    // 重置游戏状态
    room.gameStarted = false;
    room.currentPlayer = null;
    room.currentPlay = null;
    room.lastPlay = null;
}