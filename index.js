// index.js
'use strict';

document.addEventListener('DOMContentLoaded', () => {
    // Ably API Key - [安全警告] 此密钥仅供开发演示。在生产环境中，应通过后端服务获取临时Token进行认证。
    const ABLY_API_KEY = 'nc5NGw.wSmsXg:SMs5pD5aJ4hGMvNZnd7pJp2lYS2X1iCmWm_yeLx_pkk';

    // --- UI 元素引用 ---
    const ui = {
        createRoomBtn: document.getElementById('createRoomBtn'),
        joinRoomBtn: document.getElementById('joinRoomBtn'),
        joinRoomForm: document.getElementById('joinRoomForm'),
        roomCodeInput: document.getElementById('roomCodeInput'),
        notificationArea: document.getElementById('notification-area'),
        actionPanel: document.getElementById('action-panel'),
        waitingPanel: document.getElementById('waiting-panel'),
        displayRoomCode: document.getElementById('displayRoomCode'),
        roomCodeDisplay: document.getElementById('roomCodeDisplay'),
        copyFeedback: document.getElementById('copyFeedback'),
    };

    let ably = null; // Ably 实例缓存

    /**
     * 获取或生成一个唯一的用户ID (Client ID) 并存储在localStorage中。
     * Client ID 是 Ably Presence 功能所必需的，用于在频道中唯一标识一个客户端。
     * @returns {string} 用户的唯一ID
     */
    const getOrCreateClientId = () => {
        let clientId = localStorage.getItem('xiangqi_clientId');
        if (!clientId) {
            // 通过结合时间戳和随机字符串生成一个具有高唯一性的ID
            clientId = 'user-' + Date.now() + Math.random().toString(36).substring(2);
            localStorage.setItem('xiangqi_clientId', clientId);
        }
        return clientId;
    };

    /**
     * 显示通知消息
     * @param {string} message - 要显示的消息内容
     * @param {'error' | 'success'} type - 消息类型 ('error' 或 'success')
     * @param {number} duration - 消息显示时长（毫秒）
     */
    const showNotification = (message, type = 'error', duration = 4000) => {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        ui.notificationArea.innerHTML = ''; // 清空之前的通知
        ui.notificationArea.appendChild(notification);
        setTimeout(() => notification.remove(), duration);
    };

    /**
     * 初始化Ably连接 (如果尚未连接)，并返回一个已连接的实例。
     * @returns {Promise<Ably.Realtime>} Ably realtime 实例
     */
    const getAblyInstance = () => {
        return new Promise((resolve, reject) => {
            // 如果已有活动的连接，直接返回
            if (ably && ably.connection.state === 'connected') {
                return resolve(ably);
            }
            // 检查Ably库是否加载成功
            if (typeof Ably === 'undefined') {
                return reject(new Error('实时服务加载失败，请检查您的网络连接。'));
            }
            
            // [关键修复] 初始化Ably时必须提供一个唯一的 clientId 以使用 Presence 功能。
            ably = new Ably.Realtime({
                key: ABLY_API_KEY,
                clientId: getOrCreateClientId(),
                // 'recover' 选项可以在网络断开后自动恢复连接状态和消息订阅
                recover: (lastConnectionDetails, cb) => cb(true)
            });

            ably.connection.once('connected', () => {
                console.log('✅ Ably connection established with client ID:', ably.auth.clientId);
                resolve(ably);
            });

            ably.connection.once('failed', (error) => {
                console.error('Ably connection failed:', error);
                reject(new Error(`连接实时服务器失败: ${error.reason.message}`));
            });
        });
    };

    /**
     * 生成一个6位的随机房间码 (字母和数字组合)
     * @returns {string} 大写的房间码
     */
    const generateRoomCode = () => {
        return Math.random().toString(36).substring(2, 8).toUpperCase();
    };

    /**
     * 处理创建新游戏房间的逻辑
     */
    const handleCreateRoom = async () => {
        ui.createRoomBtn.disabled = true;
        ui.createRoomBtn.innerHTML = '<div class="spinner"></div> 创建中...';

        try {
            const rt = await getAblyInstance();
            const roomCode = generateRoomCode();
            const channel = rt.channels.get(`xiangqi:${roomCode}`);

            // 作为房主（红方）进入房间的 Presence 集合
            await channel.presence.enter({ player: 'red' });
            
            // 将房间信息存储到本地，以便游戏页面使用
            localStorage.setItem('xiangqi_room', roomCode);
            localStorage.setItem('xiangqi_color', 'red');

            // 更新UI，显示等待面板和房间码
            ui.displayRoomCode.textContent = roomCode;
            ui.actionPanel.classList.add('hidden');
            ui.waitingPanel.classList.remove('hidden');

            // 监听其他玩家进入房间的事件
            channel.presence.subscribe('enter', (member) => {
                // 确认是黑方玩家加入后，自动跳转到游戏页面
                if (member.data.player === 'black') {
                    window.location.href = `game.html?room=${roomCode}`;
                }
            });

        } catch (error) {
            showNotification(error.message || '创建房间失败，请刷新页面重试。');
            ui.createRoomBtn.disabled = false;
            ui.createRoomBtn.innerHTML = '<i class="fa-solid fa-plus-circle"></i>创建新对局';
        }
    };

    /**
     * 处理加入已有房间的逻辑
     * @param {Event} e - 表单提交事件对象
     */
    const handleJoinRoom = async (e) => {
        e.preventDefault();
        const roomCode = ui.roomCodeInput.value.trim().toUpperCase();
        
        // 验证房间码格式
        if (!/^[A-Z0-9]{6}$/.test(roomCode)) {
            showNotification('请输入有效的6位房间码。');
            return;
        }

        ui.joinRoomBtn.disabled = true;
        ui.joinRoomBtn.innerHTML = '<div class="spinner"></div>';

        try {
            const rt = await getAblyInstance();
            const channel = rt.channels.get(`xiangqi:${roomCode}`);
            const presence = await channel.presence.get();

            if (presence.length === 0) {
                showNotification('房间不存在或已过期。');
            } else if (presence.length === 1 && presence[0].data.player === 'red') {
                // 房间有效且只有红方玩家，可以加入
                localStorage.setItem('xiangqi_room', roomCode);
                localStorage.setItem('xiangqi_color', 'black');
                
                // 作为黑方玩家进入房间
                await channel.presence.enter({ player: 'black' });
                
                // [优化] 移除不必要的 setTimeout。`await` 确保 presence.enter 操作已发送到Ably。
                // 对方的订阅将通过 Ably 的实时机制触发，无需客户端延迟等待。
                window.location.href = `game.html?room=${roomCode}`;
            } else {
                // 房间已满（超过1人）或状态异常
                showNotification('房间已满或无法加入。');
            }
        } catch (error) {
            showNotification(error.message || '加入房间时发生网络错误。');
        } finally {
            // 无论成功失败，恢复按钮状态
            ui.joinRoomBtn.disabled = false;
            ui.joinRoomBtn.textContent = '加入';
        }
    };
    
    /**
     * 复制房间码到用户剪贴板
     */
    const handleCopyCode = () => {
        const code = ui.displayRoomCode.textContent;
        if (!code) return;
        
        navigator.clipboard.writeText(code).then(() => {
            ui.copyFeedback.textContent = '已复制到剪贴板！';
            setTimeout(() => { ui.copyFeedback.textContent = ''; }, 2000);
        }).catch(err => {
            console.error('Failed to copy code:', err);
            showNotification('复制失败，请手动复制。', 'error');
        });
    };

    // --- 事件监听器绑定 ---
    ui.createRoomBtn.addEventListener('click', handleCreateRoom);
    ui.joinRoomForm.addEventListener('submit', handleJoinRoom);
    ui.roomCodeDisplay.addEventListener('click', handleCopyCode);
    
    // 输入时自动将房间码转为大写，提升用户体验
    ui.roomCodeInput.addEventListener('input', (e) => {
        e.target.value = e.target.value.toUpperCase();
    });
});