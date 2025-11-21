const { v4: uuidv4 } = require('uuid');

// 添加详细的启动日志
console.log('=== 游戏服务器启动 ===');
console.log('环境变量:', process.env.NODE_ENV);
console.log('当前时间:', new Date().toISOString());

// 内存存储
const rooms = new Map();
const clients = new Map();

// 添加全局错误处理
process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的 Promise 拒绝:', reason);
});

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

// 检查是否为炸弹
function isBomb(cards) {
    if (cards.length === 3 || cards.length === 4) {
        const firstValue = cards[0].value;
        return cards.every(c => c.value === firstValue || c.isJoker);
    }
    return false;
}

// 验证出牌 - 修复版本
function validatePlay(cards, lastPlay, room) {
    // 如果没有上一轮出牌，可以出任意牌
    if (!lastPlay) {
        return { valid: true, type: 'any' };
    }
    
    // 检查是否为炸弹（可以随时出）
    if (isBomb(cards)) {
        return { valid: true, type: 'bomb' };
    }
    
    // 关键修复：如果上一轮所有玩家都Pass了，应该重置出牌限制
    if (room && room.allPlayersPassed) {
        return { valid: true, type: 'new_round' };
    }
    
    // 正常情况：出牌数量必须与上家相同
    if (cards.length !== lastPlay.cards.length) {
        return { valid: false, message: "出牌数量必须与上家相同" };
    }
    
    return { valid: true, type: 'normal' };
}

// 清理过期数据 - 优化版本
function cleanupExpiredData() {
    const now = Date.now();
    console.log(`清理前: ${rooms.size} 个房间, ${clients.size} 个客户端`);
    
    // 清理过期的客户端（15分钟无活动）
    for (let [clientId, client] of clients.entries()) {
        if (now - client.lastSeen > 900000) {
            console.log(`清理过期客户端: ${clientId}`);
            clients.delete(clientId);
        }
    }
    
    // 更保守的房间清理策略
    for (let [roomId, room] of rooms.entries()) {
        const roomAge = now - room.createdAt;
        const lastActivity = room.lastActivity || room.createdAt;
        const inactiveTime = now - lastActivity;
        
        // 空房间：立即清理
        if (room.players.length === 0) {
            console.log(`清理空房间: ${roomId}`);
            rooms.delete(roomId);
        }
        // 游戏中的房间：2小时无活动才清理
        else if (room.gameStarted && inactiveTime > 7200000) {
            console.log(`清理长时间无活动的游戏房间: ${roomId}, 无活动时间: ${Math.round(inactiveTime/1000)}秒`);
            rooms.delete(roomId);
        }
        // 未开始游戏的房间：1小时无活动清理
        else if (!room.gameStarted && inactiveTime > 3600000) {
            console.log(`清理长时间无活动的等待房间: ${roomId}, 无活动时间: ${Math.round(inactiveTime/1000)}秒`);
            rooms.delete(roomId);
        }
        // 房间存在时间超过6小时：强制清理（防止内存泄漏）
        else if (roomAge > 21600000) {
            console.log(`清理超时房间: ${roomId}, 存活时间: ${Math.round(roomAge/1000)}秒`);
            rooms.delete(roomId);
        }
    }
    
    console.log(`清理后: ${rooms.size} 个房间, ${clients.size} 个客户端`);
}

// 检查房间是否存在
function handleCheckRoom(roomId) {
    const room = rooms.get(roomId.toUpperCase());
    return {
        success: true,
        exists: !!room,
        roomId: roomId,
        room: room ? {
            playerCount: room.players.length,
            gameStarted: room.gameStarted,
            players: room.players.map(p => p.name)
        } : null
    };
}

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
        currentPlayer: null,
        gameStarted: false,
        drawPile: [],
        discardPile: [],
        currentPlay: null,
        lastPlay: null,
        allPlayersPassed: false, // 新增：跟踪是否所有玩家都Pass了
        lastActivity: Date.now(), // 新增：最后活动时间
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
    
    console.log(`房间创建: ${roomId}, 玩家: ${player.name}, 总房间数: ${rooms.size}`);
    
    return {
        success: true,
        type: 'room_created',
        roomId: roomId,
        playerId: playerId
    };
}

// 加入房间 - 修复房间查找逻辑
function handleJoinRoom(roomId, playerName, clientId) {
    if (!roomId) {
        return { success: false, error: '房间号不能为空' };
    }
    
    // 统一转为大写查找
    const roomIdUpper = roomId.toUpperCase().trim();
    const room = rooms.get(roomIdUpper);
    
    if (!room) {
        // 返回所有可用房间用于调试
        const availableRooms = Array.from(rooms.keys());
        console.log(`房间不存在: ${roomIdUpper}, 可用房间: ${availableRooms.join(', ')}`);
        return { 
            success: false, 
            error: '房间不存在',
            debug: {
                requested: roomId,
                normalized: roomIdUpper,
                availableRooms: availableRooms,
                totalRooms: rooms.size
            }
        };
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
    room.lastActivity = Date.now(); // 更新活动时间
    
    if (clientId) {
        const client = clients.get(clientId);
        if (client) {
            client.roomId = roomIdUpper;
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
    
    console.log(`玩家 ${player.name} 加入房间: ${roomIdUpper}, 当前玩家数: ${room.players.length}`);
    
    return {
        success: true,
        type: 'room_joined',
        roomId: roomIdUpper,
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
    if (!roomId) {
        return { success: false, error: '房间号不能为空' };
    }
    
    const room = rooms.get(roomId.toUpperCase());
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
            rooms.delete(room.id);
            console.log(`房间 ${room.id} 已被删除（无玩家）`);
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

// 开始游戏 - 修复版本
function handleStartGame(roomId, playerId) {
    console.log(`处理开始游戏请求: 房间 ${roomId}, 玩家 ${playerId}`);
    
    const room = rooms.get(roomId);
    if (!room) {
        console.log(`房间不存在: ${roomId}`);
        return { success: false, error: '房间不存在' };
    }
    
    // 检查请求者是否是房间中的玩家
    const requestingPlayer = room.players.find(p => p.id === playerId);
    if (!requestingPlayer) {
        console.log(`玩家 ${playerId} 不在房间 ${roomId} 中`);
        return { success: false, error: '玩家不在房间中' };
    }
    
    if (room.players.length < 2) {
        console.log(`玩家数量不足: ${room.players.length}`);
        return { success: false, error: '至少需要2名玩家才能开始游戏' };
    }
    
    if (room.gameStarted) {
        console.log(`游戏已经开始了`);
        return { success: false, error: '游戏已经开始了' };
    }
    
    try {
        room.gameStarted = true;
        room.currentPlayer = room.dealer;
        
        console.log(`开始发牌...`);
        dealCards(room);
        room.recentPlays = []; // 初始化出牌记录
        room.players.forEach(player => {
            player.passed = false; // 初始化PASS状态
        });

        // 通知所有玩家游戏开始
        room.players.forEach(player => {
            player.pendingMessages.push({
                type: 'game_started',
                dealer: room.dealer,
                currentPlayer: room.currentPlayer,
                message: '游戏开始！庄家先出牌'
            });
            
            // 为每个玩家发送手牌
            player.pendingMessages.push({
                type: 'player_hand',
                hand: player.hand,
                handCount: player.hand.length
            });
            
            console.log(`向玩家 ${player.name} 发送了 ${player.hand.length} 张牌`);
        });
        
        console.log(`游戏开始成功: ${roomId}, 庄家: ${room.dealer}, 玩家数: ${room.players.length}`);
        
        return { 
            success: true, 
            type: 'game_started',
            message: '游戏开始成功'
        };
    } catch (error) {
        console.error('开始游戏过程中出错:', error);
        room.gameStarted = false;
        return { success: false, error: '开始游戏失败: ' + error.message };
    }
}

// 出牌 - 增强版本
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
    
    // 验证出牌 - 传入room参数
    const validation = validatePlay(cards, room.lastPlay, room);
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
    room.lastActivity = Date.now(); // 更新活动时间

    // 重置Pass状态（有玩家出牌了）
    room.allPlayersPassed = false;
    room.players.forEach(p => p.passed = false);
    
    // 记录出牌历史
    if (!room.recentPlays) {
        room.recentPlays = [];
    }
    room.recentPlays.push({
        playerName: player.name,
        cards: cards
    });

    // 限制出牌记录数量（保留最近4条，即2轮）
    if (room.recentPlays.length > 4) {
        room.recentPlays = room.recentPlays.slice(-4);
    }
    
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
            newHandCount: player.cards,
            allPlayersPassed: room.allPlayersPassed
        });
    });
    
    // 检查游戏是否结束
    if (player.cards === 0) {
        endGame(room, player);
    }
    
    return { success: true, type: 'cards_played' };
}

// 不出牌 - 增强版本
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
    player.passed = true;
    room.lastActivity = Date.now(); // 更新活动时间
    
    // 检查是否所有玩家都Pass了（除了当前出牌的玩家）
    const activePlayers = room.players.filter(p => !p.passed);
    if (activePlayers.length <= 1) {
        // 所有玩家都Pass了，重置出牌限制
        room.allPlayersPassed = true;
        room.lastPlay = null; // 清空上一轮出牌记录
        
        // 重置所有玩家的Pass状态
        room.players.forEach(p => p.passed = false);
        
        console.log('一轮结束，重置出牌限制');
    }
    
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
            nextPlayer: room.currentPlayer,
            allPlayersPassed: room.allPlayersPassed // 通知客户端是否重置了出牌限制
        });
    });
    
    return { success: true, type: 'turn_passed' };
}

// 获取更新 - 增强版本
function handleGetUpdates(roomId, playerId, clientId) {
    if (!roomId || !playerId) {
        return { 
            success: true, 
            type: 'updates', 
            messages: [],
            roomState: null 
        };
    }
    
    const room = rooms.get(roomId);
    if (!room) {
        console.log(`房间不存在: ${roomId}, 可用房间: ${Array.from(rooms.keys())}`);
        return { 
            success: false, 
            error: '房间不存在',
            debug: {
                requestedRoom: roomId,
                availableRooms: Array.from(rooms.keys())
            }
        };
    }
    
    const player = room.players.find(p => p.id === playerId);
    if (!player) {
        return { 
            success: false, 
            error: '玩家不存在',
            roomState: null
        };
    }
    
    // 更新房间活动时间，防止被清理
    room.lastActivity = Date.now();
    
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
                isCurrent: p.id === room.currentPlayer,
                passed: p.passed || false
            })),
            currentPlayer: room.currentPlayer,
            gameStarted: room.gameStarted,
            lastPlay: room.lastPlay,
            drawPileCount: room.drawPile ? room.drawPile.length : 0,
            recentPlays: room.recentPlays || [],
            allPlayersPassed: room.allPlayersPassed || false // 新增状态
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
    room.allPlayersPassed = false;
}

// 主处理函数
module.exports = async (req, res) => {
    const startTime = Date.now();
    console.log('=== 收到请求 ===');
    console.log('方法:', req.method);
    console.log('URL:', req.url);
    console.log('路径:', req.url.split('?')[0]);
    
    // 设置响应超时
    res.setTimeout(9000, () => {
        if (!res.headersSent) {
            console.log('请求超时:', req.url);
            res.status(503).json({ error: '请求超时' });
        }
    });
    
    // 设置 CORS 头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
        console.log('处理 OPTIONS 预检请求');
        res.status(200).end();
        return;
    }
    
    const { method, url } = req;
    const path = url.split('?')[0];
    
    try {
        // 健康检查端点
        if ((path === '/health' || path === '/api/health') && method === 'GET') {
            const roomList = Array.from(rooms.entries()).map(([id, room]) => ({
                id: id,
                playerCount: room.players.length,
                gameStarted: room.gameStarted,
                createdAt: room.createdAt,
                players: room.players.map(p => p.name)
            }));
            
            res.json({ 
                status: 'ok', 
                rooms: rooms.size,
                clients: clients.size,
                roomList: roomList,
                timestamp: new Date().toISOString()
            });
            return;
        }
        
        // 调试端点：查看所有房间详情
        if (path === '/debug' && method === 'GET') {
            const debugInfo = {
                totalRooms: rooms.size,
                totalClients: clients.size,
                rooms: Array.from(rooms.entries()).map(([id, room]) => ({
                    id: id,
                    playerCount: room.players.length,
                    gameStarted: room.gameStarted,
                    createdAt: new Date(room.createdAt).toISOString(),
                    players: room.players.map(p => ({
                        id: p.id,
                        name: p.name,
                        cards: p.cards
                    })),
                    currentPlayer: room.currentPlayer,
                    dealer: room.dealer
                })),
                timestamp: new Date().toISOString()
            };
            
            res.json(debugInfo);
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
        
        // 调试端点：查看特定房间
        if (path.startsWith('/api/room/') && method === 'GET') {
            const roomId = path.split('/').pop().toUpperCase();
            const room = rooms.get(roomId);
            if (room) {
                res.json({
                    exists: true,
                    roomId: room.id,
                    playerCount: room.players.length,
                    gameStarted: room.gameStarted,
                    players: room.players.map(p => ({ id: p.id, name: p.name })),
                    createdAt: room.createdAt
                });
            } else {
                res.json({ 
                    exists: false,
                    availableRooms: Array.from(rooms.keys())
                });
            }
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
            
            // 新的参数提取方式
            const { action, clientId, ...requestBody } = body;

            // 根据action提取不同的参数
            let roomId, playerId;

            // 对于需要roomId和playerId的action，从requestBody中提取
            if (action !== 'create_room' && action !== 'join_room' && action !== 'check_room') {
                roomId = requestBody.roomId;
                playerId = requestBody.playerId;
            }
            
            // 添加详细的调试日志
            console.log(`处理请求: ${method} ${path}, 房间: ${roomId}, 玩家: ${playerId}, 动作: ${action}`);
            
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

            // 修改switch语句，直接使用requestBody
            switch (action) {
                case 'create_room':
                    result = handleCreateRoom(requestBody.playerName, clientId);
                    break;
                case 'join_room':
                    result = handleJoinRoom(requestBody.roomId, requestBody.playerName, clientId);
                    break;
                case 'leave_room':
                    result = handleLeaveRoom(roomId, playerId, clientId);
                    break;
                case 'start_game':
                    result = handleStartGame(roomId, playerId);
                    break;
                case 'play_cards':
                    result = handlePlayCards(roomId, playerId, requestBody.cards);
                    break;
                case 'pass_turn':
                    result = handlePassTurn(roomId, playerId);
                    break;
                case 'get_updates':
                    result = handleGetUpdates(roomId, playerId, clientId);
                    break;
                case 'check_room':
                    result = handleCheckRoom(requestBody.roomId);
                    break;
                default:
                    res.status(400).json({ error: '未知的操作', action: action });
                    return;
            }
            
            // 清理过期数据（每10次请求清理一次，减少性能影响）
            if (Math.random() < 0.1) {
                cleanupExpiredData();
            }
            
            // 记录执行时间
            const executionTime = Date.now() - startTime;
            console.log(`请求处理完成: ${executionTime}ms`);
            
            res.json(result);
            return;
        }
        
        // 默认响应
        res.json({ 
            message: '干瞪眼儿游戏服务器 API',
            endpoints: ['/health', '/debug', '/rooms', '/api/game', '/api/room/:id'],
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