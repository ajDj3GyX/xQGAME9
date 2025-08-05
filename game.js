// game.js
'use strict';

document.addEventListener('DOMContentLoaded', () => {

    // ===================================================================
    // # 1. Core Configuration & Constants
    // ===================================================================
    const ABLY_API_KEY = 'nc5NGw.wSmsXg:SMs5pD5aJ4hGMvNZnd7pJp2lYS2X1iCmWm_yeLx_pkk';
    const BOARD_COLS = 9;
    const BOARD_ROWS = 10;
    
    // Piece definitions: ID -> { text, color, type }
    const PIECE_DATA = {
        r_g: { text: '帅', color: 'red', type: 'general'  }, r_a: { text: '仕', color: 'red', type: 'advisor'  },
        r_e: { text: '相', color: 'red', type: 'elephant' }, r_h: { text: '傌', color: 'red', type: 'horse'    },
        r_c: { text: '俥', color: 'red', type: 'chariot'  }, r_p: { text: '炮', color: 'red', type: 'cannon'   },
        r_s: { text: '兵', color: 'red', type: 'soldier'  },
        b_g: { text: '将', color: 'black', type: 'general'  }, b_a: { text: '士', color: 'black', type: 'advisor'  },
        b_e: { text: '象', color: 'black', type: 'elephant' }, b_h: { text: '馬', color: 'black', type: 'horse'    },
        b_c: { text: '車', color: 'black', type: 'chariot'  }, b_p: { text: '砲', color: 'black', type: 'cannon'   },
        b_s: { text: '卒', color: 'black', type: 'soldier'  },
    };

    // Initial board layout: y -> x -> pieceId
    const INITIAL_LAYOUT = {
        0: { 0: 'r_c', 1: 'r_h', 2: 'r_e', 3: 'r_a', 4: 'r_g', 5: 'r_a', 6: 'r_e', 7: 'r_h', 8: 'r_c' },
        2: { 1: 'r_p', 7: 'r_p' },
        3: { 0: 'r_s', 2: 'r_s', 4: 'r_s', 6: 'r_s', 8: 'r_s' },
        6: { 0: 'b_s', 2: 'b_s', 4: 'b_s', 6: 'b_s', 8: 'b_s' },
        7: { 1: 'b_p', 7: 'b_p' },
        9: { 0: 'b_c', 1: 'b_h', 2: 'b_e', 3: 'b_a', 4: 'b_g', 5: 'b_a', 6: 'b_e', 7: 'b_h', 8: 'b_c' },
    };


    // ===================================================================
    // # 2. Modular Game Classes
    // ===================================================================

    /**
     * @class GameState
     * @description Manages all game state, acting as the Single Source of Truth.
     */
    class GameState {
        constructor(playerColor) {
            this.playerColor = playerColor; // 'red' or 'black'
            this.board = this.createInitialBoard();
            this.currentTurn = 'red';
            this.gameActive = true;
            this.selectedPiece = null; // { x, y } of the selected piece
            this.moveHistory = []; // Stores move objects for undo functionality
            this.opponentConnected = false;
        }

        createInitialBoard() {
            const board = Array(BOARD_ROWS).fill(null).map(() => Array(BOARD_COLS).fill(null));
            for (const y in INITIAL_LAYOUT) {
                for (const x in INITIAL_LAYOUT[y]) {
                    board[y][x] = INITIAL_LAYOUT[y][x];
                }
            }
            return board;
        }

        getPiece(x, y) { return this.board[y]?.[x]; }
        isMyTurn() { return this.gameActive && this.currentTurn === this.playerColor && this.opponentConnected; }

        movePiece(from, to) {
            const movedPieceId = this.getPiece(from.x, from.y);
            const capturedPieceId = this.getPiece(to.x, to.y);
            
            // Record the move for history/undo
            this.moveHistory.push({ from, to, movedPieceId, capturedPieceId });
            
            // Update the board state
            this.board[to.y][to.x] = movedPieceId;
            this.board[from.y][from.x] = null;
            this.currentTurn = this.currentTurn === 'red' ? 'black' : 'red';
            
            return { movedPieceId, capturedPieceId };
        }
        
        undoLastMove() {
            if (this.moveHistory.length === 0) return;
            const lastMove = this.moveHistory.pop();
            const { from, to, movedPieceId, capturedPieceId } = lastMove;
            
            // Revert the move
            this.board[from.y][from.x] = movedPieceId;
            this.board[to.y][to.x] = capturedPieceId; // Restore captured piece
            
            this.currentTurn = this.currentTurn === 'red' ? 'black' : 'red';
        }
    }

    /**
     * @class GameLogic
     * @description Contains all pure game rules and logic, with no side effects.
     */
    class GameLogic {
        // Core move validation, doesn't check for check state
        static _isPseudoLegalMove(board, from, to) {
            const pieceId = board[from.y]?.[from.x];
            if (!pieceId) return false;
            const piece = PIECE_DATA[pieceId];
            const targetPieceId = board[to.y]?.[to.x];
            const targetPiece = targetPieceId ? PIECE_DATA[targetPieceId] : null;

            if (targetPiece && targetPiece.color === piece.color) return false;

            const dx = to.x - from.x;
            const dy = to.y - from.y;
            const absDx = Math.abs(dx);
            const absDy = Math.abs(dy);

            switch (piece.type) {
                case 'general':
                    if (to.x < 3 || to.x > 5 || (piece.color === 'red' ? to.y < 7 : to.y > 2)) return false;
                    // Flying general rule (Generals cannot face each other on the same file with no pieces between)
                    if (targetPiece?.type === 'general') {
                        if (from.x !== to.x) return false;
                        return this.countPiecesOnPath(board, from, to) === 0;
                    }
                    return absDx + absDy === 1;
                case 'advisor':
                    if (to.x < 3 || to.x > 5 || (piece.color === 'red' ? to.y < 7 : to.y > 2)) return false;
                    return absDx === 1 && absDy === 1;
                case 'elephant':
                    if (piece.color === 'red' ? to.y < 5 : to.y > 4) return false; // Cannot cross river
                    if (absDx !== 2 || absDy !== 2) return false;
                    return !board[from.y + dy / 2][from.x + dx / 2]; // Cannot be blocked
                case 'horse':
                    if (!((absDx === 1 && absDy === 2) || (absDx === 2 && absDy === 1))) return false;
                    const blockX = from.x + (absDx === 2 ? Math.sign(dx) : 0);
                    const blockY = from.y + (absDy === 2 ? Math.sign(dy) : 0);
                    return !board[blockY]?.[blockX]; // Cannot be blocked
                case 'chariot':
                    if (dx !== 0 && dy !== 0) return false;
                    return this.countPiecesOnPath(board, from, to) === 0;
                case 'cannon':
                    if (dx !== 0 && dy !== 0) return false;
                    const pathPieces = this.countPiecesOnPath(board, from, to);
                    return targetPiece ? pathPieces === 1 : pathPieces === 0;
                case 'soldier':
                    const forward = piece.color === 'red' ? -1 : 1;
                    if (dy === forward && dx === 0) return true; // Move forward
                    const hasCrossedRiver = piece.color === 'red' ? from.y < 5 : from.y > 4;
                    return hasCrossedRiver && dy === 0 && absDx === 1; // Move sideways after crossing river
            }
            return false;
        }

        static countPiecesOnPath(board, from, to) {
            let count = 0;
            if (from.x === to.x) { // Vertical path
                for (let y = Math.min(from.y, to.y) + 1; y < Math.max(from.y, to.y); y++) if (board[y]?.[from.x]) count++;
            } else if (from.y === to.y) { // Horizontal path
                for (let x = Math.min(from.x, to.x) + 1; x < Math.max(from.x, to.x); x++) if (board[from.y]?.[x]) count++;
            }
            return count;
        }

        static findKing(board, color) {
            const kingId = color === 'red' ? 'r_g' : 'b_g';
            for (let y = 0; y < BOARD_ROWS; y++) {
                for (let x = 0; x < BOARD_COLS; x++) {
                    if (board[y][x] === kingId) return { x, y };
                }
            }
            return null;
        }
        
        static isKingInCheck(board, kingColor) {
            const kingPos = this.findKing(board, kingColor);
            if (!kingPos) return true; // King is captured, which is a form of checkmate.
            const opponentColor = kingColor === 'red' ? 'black' : 'red';
            for (let y = 0; y < BOARD_ROWS; y++) {
                for (let x = 0; x < BOARD_COLS; x++) {
                    const pieceId = board[y][x];
                    if (pieceId && PIECE_DATA[pieceId].color === opponentColor) {
                        if (this._isPseudoLegalMove(board, { x, y }, kingPos)) {
                            return true;
                        }
                    }
                }
            }
            return false;
        }

        // The primary function to get all valid moves for a piece, ensuring it doesn't result in a check.
        static getValidMoves(board, fromX, fromY) {
            const pieceId = board[fromY]?.[fromX];
            if (!pieceId) return [];
            const pieceColor = PIECE_DATA[pieceId].color;
            const validMoves = [];

            for (let y = 0; y < BOARD_ROWS; y++) {
                for (let x = 0; x < BOARD_COLS; x++) {
                    if (this._isPseudoLegalMove(board, { x: fromX, y: fromY }, { x, y })) {
                        // Simulate the move on a temporary board
                        const tempBoard = JSON.parse(JSON.stringify(board));
                        tempBoard[y][x] = tempBoard[fromY][fromX];
                        tempBoard[fromY][fromX] = null;
                        // If the move does not leave the king in check, it's a legal move.
                        if (!this.isKingInCheck(tempBoard, pieceColor)) {
                            validMoves.push({ x, y });
                        }
                    }
                }
            }
            return validMoves;
        }
        
        static getAllLegalMovesForPlayer(board, color) {
            let allMoves = [];
            for (let y = 0; y < BOARD_ROWS; y++) {
                for (let x = 0; x < BOARD_COLS; x++) {
                    const pieceId = board[y][x];
                    if (pieceId && PIECE_DATA[pieceId].color === color) {
                        const moves = this.getValidMoves(board, x, y);
                        if (moves.length > 0) allMoves.push(...moves);
                    }
                }
            }
            return allMoves;
        }

        // Checks for game-ending conditions like Checkmate or Stalemate.
        static checkGameEndCondition(board, turnColor) {
            const hasLegalMoves = this.getAllLegalMovesForPlayer(board, turnColor).length > 0;
            const inCheck = this.isKingInCheck(board, turnColor);
            const opponentColor = turnColor === 'red' ? 'black' : 'red';

            if (!hasLegalMoves) {
                if (inCheck) {
                    return { over: true, winner: opponentColor, reason: "Checkmate" };
                } else {
                    return { over: true, winner: 'draw', reason: "Stalemate" };
                }
            }
            // Check for flying general condition if not in check, which is a draw in some rules, but here we treat it as an illegal move.
            const kingPos = this.findKing(board, turnColor);
            const oppKingPos = this.findKing(board, opponentColor);
            if (kingPos && oppKingPos && kingPos.x === oppKingPos.x && this.countPiecesOnPath(board, kingPos, oppKingPos) === 0) {
                 return { over: true, winner: opponentColor, reason: "Illegal Move (Flying General)" };
            }
            
            return { over: false };
        }
    }
    
    /**
     * @class UIRenderer
     * @description Handles all DOM manipulations and UI rendering.
     */
    class UIRenderer {
        constructor(onCellClick) {
            this.elements = {
                board: document.getElementById('board'),
                roomCodeDisplay: document.getElementById('roomCodeDisplay'),
                gameStatus: document.getElementById('gameStatus'),
                undoBtn: document.getElementById('undoBtn'),
                surrenderBtn: document.getElementById('surrenderBtn'),
                modal: document.getElementById('game-modal'),
                playerRedTag: document.getElementById('player-red'),
                playerBlackTag: document.getElementById('player-black'),
            };
            this.onCellClick = onCellClick;
            this.pieceElements = {}; // Cache for piece DOM elements { 'x,y': element }
        }
        
        initialize(roomCode, playerColor) {
            this.elements.roomCodeDisplay.textContent = roomCode;
            this.elements.playerRedTag.classList.toggle('is-self', playerColor === 'red');
            this.elements.playerBlackTag.classList.toggle('is-self', playerColor === 'black');
        }

        renderBoard(board) {
            this.elements.board.innerHTML = '';
            this.pieceElements = {};
            
            for (let y = 0; y < BOARD_ROWS; y++) {
                for (let x = 0; x < BOARD_COLS; x++) {
                    // Create clickable cell areas
                    const cell = document.createElement('div');
                    cell.className = 'cell';
                    cell.dataset.x = x;
                    cell.dataset.y = y;
                    cell.addEventListener('click', () => this.onCellClick(x, y));
                    this.elements.board.appendChild(cell);

                    const pieceId = board[y][x];
                    if (pieceId) this.createPieceElement(pieceId, x, y);
                }
            }
        }
        
        createPieceElement(pieceId, x, y) {
            const pData = PIECE_DATA[pieceId];
            const pieceEl = document.createElement('div');
            pieceEl.className = `piece ${pData.color}`;
            pieceEl.textContent = pData.text;
            pieceEl.dataset.piece = pieceId;
            this.updateElementPosition(pieceEl, x, y);
            
            this.elements.board.appendChild(pieceEl);
            this.pieceElements[`${x},${y}`] = pieceEl;
        }
        
        updateElementPosition(element, x, y) {
            // Position pieces based on the grid layout
            const xPercent = (x / (BOARD_COLS - 1)) * 100;
            const yPercent = (y / (BOARD_ROWS - 1)) * 100;
            element.style.transform = `translate(${xPercent}%, ${yPercent}%) translate(-50%, -50%)`;
        }

        animateMove(from, to, capturedPieceId) {
            const movingPieceEl = this.pieceElements[`${from.x},${from.y}`];
            if (!movingPieceEl) return;

            // Animate the move
            movingPieceEl.classList.add('moving');
            movingPieceEl.style.zIndex = 100; // Bring to front during move
            this.updateElementPosition(movingPieceEl, to.x, to.y);

            const handleTransitionEnd = () => {
                movingPieceEl.removeEventListener('transitionend', handleTransitionEnd);
                movingPieceEl.classList.remove('moving');
                movingPieceEl.style.zIndex = 10;

                // Handle capture
                if (capturedPieceId) {
                    const capturedEl = this.pieceElements[`${to.x},${to.y}`];
                    if (capturedEl) capturedEl.remove();
                }
                
                // Update element cache
                delete this.pieceElements[`${from.x},${from.y}`];
                this.pieceElements[`${to.x},${to.y}`] = movingPieceEl;
                
                this.clearHighlights();
                this.highlightLastMove(from, to);
            };
            movingPieceEl.addEventListener('transitionend', handleTransitionEnd);
        }

        updateStatus(text, type = 'info') {
            const turnColor = type === 'red' || type === 'black' ? type : null;

            this.elements.gameStatus.innerHTML = `<span>${text}</span>`;
            this.elements.gameStatus.className = 'info'; // Reset classes
            if (type) this.elements.gameStatus.classList.add(type);
            
            // Highlight current player's tag
            this.elements.playerRedTag.classList.toggle('is-turn', turnColor === 'red');
            this.elements.playerBlackTag.classList.toggle('is-turn', turnColor === 'black');
        }
        
        updateButtonStates(gameState) {
            // Can only undo if it's your turn and there's history. Opponent must have made at least one move.
            this.elements.undoBtn.disabled = !gameState.isMyTurn() || gameState.moveHistory.length < 1;
            this.elements.surrenderBtn.disabled = !gameState.gameActive;
        }
        
        clearHighlights() {
            document.querySelectorAll('.selected, .move-indicator, .last-move-highlight').forEach(el => el.remove());
        }

        highlightSelected(x, y) {
            this.clearHighlights();
            const pieceEl = this.pieceElements[`${x},${y}`];
            if (pieceEl) {
                const indicator = document.createElement('div');
                indicator.className = 'selected';
                pieceEl.appendChild(indicator);
            }
        }

        highlightValidMoves(moves) {
            moves.forEach(move => {
                const indicator = document.createElement('div');
                indicator.className = 'move-indicator';
                // A piece being on the target square indicates a capture
                if (this.pieceElements[`${move.x},${move.y}`]) {
                    indicator.classList.add('capture');
                }
                const cell = this.elements.board.querySelector(`.cell[data-x='${move.x}'][data-y='${move.y}']`);
                if (cell) cell.appendChild(indicator);
            });
        }

        highlightLastMove(from, to) {
            [from, to].forEach(pos => {
                const highlight = document.createElement('div');
                highlight.className = 'last-move-highlight';
                const cell = this.elements.board.querySelector(`.cell[data-x='${pos.x}'][data-y='${pos.y}']`);
                if(cell) cell.appendChild(highlight);
            });
        }
        
        showModal({ title, content, buttons }) {
            this.elements.modal.querySelector('#modal-title').textContent = title;
            this.elements.modal.querySelector('#modal-text').textContent = content;
            const actionsContainer = this.elements.modal.querySelector('.modal-actions');
            actionsContainer.innerHTML = ''; // Clear previous buttons
            
            buttons.forEach(btn => {
                const buttonEl = document.createElement('button');
                buttonEl.id = btn.id;
                buttonEl.textContent = btn.text;
                buttonEl.className = btn.class;
                buttonEl.addEventListener('click', btn.callback);
                actionsContainer.appendChild(buttonEl);
            });
            
            this.elements.modal.showModal();
        }
        
        hideModal() { this.elements.modal.close(); }
    }

    /**
     * @class NetworkController
     * @description Encapsulates all Ably real-time communication.
     */
    class NetworkController {
        constructor(roomId, onMessage, onPresenceUpdate) {
            try {
                this.ably = new Ably.Realtime({ key: ABLY_API_KEY, recover: (lcd, cb) => cb(true) });
                this.channel = this.ably.channels.get(`xiangqi:${roomId}`);
                this.onMessage = onMessage;
                this.onPresenceUpdate = onPresenceUpdate;

                this.ably.connection.on('connected', () => console.log('✅ Ably connection established.'));
                this.ably.connection.on('failed', (err) => console.error('Ably connection failed.', err.reason));
            } catch (error) {
                console.error("Failed to initialize Ably:", error);
                alert("Could not connect to the real-time service. Please check your connection and refresh.");
            }
        }
        
        subscribeToEvents() {
            this.channel.subscribe(msg => this.onMessage(msg.name, msg.data));
            this.channel.presence.subscribe(['enter', 'leave'], () => this.onPresenceUpdate());
            this.onPresenceUpdate(); // Initial check on joining
        }
        
        async enterPresence(playerColor) {
            await this.channel.presence.enter({ color: playerColor });
        }
        
        publish(name, data) { this.channel.publish(name, data); }
        async getPresence() { return await this.channel.presence.get(); }
    }

    /**
     * @class GameController
     * @description The main controller, orchestrating all modules.
     */
    class GameController {
        constructor() {
            const urlParams = new URLSearchParams(window.location.search);
            this.roomId = urlParams.get('room');
            const playerColor = localStorage.getItem('xiangqi_color');
            
            if (!this.roomId || !playerColor) {
                alert("Game information missing. Returning to lobby.");
                window.location.href = 'index.html';
                return;
            }

            this.gameState = new GameState(playerColor);
            this.ui = new UIRenderer(this.handleCellClick.bind(this));
            this.network = new NetworkController(
                this.roomId, 
                this.handleNetworkMessage.bind(this),
                this.handlePresenceUpdate.bind(this)
            );

            this.initializeGame();
        }

        async initializeGame() {
            this.ui.initialize(this.roomId, this.gameState.playerColor);
            this.ui.renderBoard(this.gameState.board);
            await this.network.enterPresence(this.gameState.playerColor);
            this.network.subscribeToEvents();
            this.addEventListeners();
            this.updateGameStatusUI();
        }
        
        addEventListeners() {
            this.ui.elements.undoBtn.addEventListener('click', () => this.requestUndo());
            this.ui.elements.surrenderBtn.addEventListener('click', () => this.confirmSurrender());
        }

        updateGameStatusUI() {
            if (!this.gameState.gameActive) return;
            
            if (!this.gameState.opponentConnected) {
                this.ui.updateStatus('Waiting for opponent to connect...', 'wait');
            } else if (this.gameState.isMyTurn()) {
                this.ui.updateStatus('Your turn', this.gameState.currentTurn);
            } else {
                this.ui.updateStatus("Opponent's turn...", this.gameState.currentTurn);
            }
            this.ui.updateButtonStates(this.gameState);
        }
        
        async handlePresenceUpdate() {
            const presence = await this.network.getPresence();
            const wasConnected = this.gameState.opponentConnected;
            this.gameState.opponentConnected = presence.length === 2;
            
            if (!wasConnected && this.gameState.opponentConnected) {
                console.log("Opponent has connected.");
            } else if (wasConnected && !this.gameState.opponentConnected && this.gameState.gameActive) {
                console.log("Opponent has disconnected.");
                const winner = this.gameState.playerColor;
                this.endGame(winner, 'Opponent disconnected.');
            }
            
            this.updateGameStatusUI();
        }

        handleCellClick(x, y) {
            if (!this.gameState.isMyTurn()) return;
            
            const pieceId = this.gameState.getPiece(x, y);
            
            if (this.gameState.selectedPiece) {
                const from = this.gameState.selectedPiece;
                const to = { x, y };

                // Deselect if clicking the same piece
                if (from.x === to.x && from.y === to.y) {
                    this.gameState.selectedPiece = null;
                    this.ui.clearHighlights();
                    return;
                }

                // Check if the target is a valid move
                const validMoves = GameLogic.getValidMoves(this.gameState.board, from.x, from.y);
                if (validMoves.some(move => move.x === to.x && move.y === to.y)) {
                    this.performMove(from, to, true);
                } else {
                    this.selectPiece(x, y); // Select another piece or empty cell
                }
            } else {
                this.selectPiece(x, y);
            }
        }
        
        selectPiece(x, y) {
            const pieceId = this.gameState.getPiece(x, y);
            // Only select if it's your piece
            if (pieceId && PIECE_DATA[pieceId].color === this.gameState.playerColor) {
                this.gameState.selectedPiece = { x, y };
                this.ui.highlightSelected(x, y);
                const validMoves = GameLogic.getValidMoves(this.gameState.board, x, y);
                this.ui.highlightValidMoves(validMoves);
            } else {
                this.gameState.selectedPiece = null;
                this.ui.clearHighlights();
            }
        }

        performMove(from, to, isLocalAction) {
            const { capturedPieceId } = this.gameState.movePiece(from, to);
            this.ui.animateMove(from, to, capturedPieceId);
            this.gameState.selectedPiece = null;
            
            // If this move originated from the local player, publish it
            if (isLocalAction) {
                this.network.publish('move', { from, to });
                
                // Check for game over condition
                const gameEndState = GameLogic.checkGameEndCondition(this.gameState.board, this.gameState.currentTurn);
                if (gameEndState.over) {
                    this.network.publish('game-over', gameEndState);
                    this.endGame(gameEndState.winner, gameEndState.reason);
                } else if (GameLogic.isKingInCheck(this.gameState.board, this.gameState.currentTurn)) {
                    this.network.publish('check', { color: this.gameState.currentTurn });
                    this.ui.updateStatus('Check!', this.gameState.currentTurn);
                }
            }
            
            this.updateGameStatusUI();
        }
        
        endGame(winner, reason) {
            if (!this.gameState.gameActive) return; // Prevent multiple endings
            this.gameState.gameActive = false;
            
            const isWinner = winner === this.gameState.playerColor;
            const title = winner === 'draw' ? 'Draw!' : (isWinner ? 'You Won!' : 'You Lost');
            this.ui.updateStatus(title, isWinner ? 'win' : 'lose');
            this.ui.updateButtonStates(this.gameState);

            this.ui.showModal({
                title,
                content: `Game Over. Reason: ${reason}`,
                buttons: [{
                    id: 'modal-back-home',
                    text: 'Return to Lobby',
                    class: 'btn btn-primary',
                    callback: () => window.location.href='index.html'
                }]
            });
        }

        handleNetworkMessage(name, data) {
            if (!this.gameState.gameActive && !['game-over', 'undo:response'].includes(name)) return;

            switch (name) {
                case 'move':
                    this.performMove(data.from, data.to, false);
                    break;
                case 'check':
                    this.ui.updateStatus('Check!', data.color);
                    break;
                case 'undo:request':
                    this.handleUndoRequest();
                    break;
                case 'undo:response':
                    this.handleUndoResponse(data.accepted);
                    break;
                case 'game-over':
                    this.endGame(data.winner, `Opponent declared ${data.reason}.`);
                    break;
            }
        }
        
        requestUndo() {
            this.ui.elements.undoBtn.disabled = true;
            this.network.publish('undo:request', {});
            this.ui.updateStatus("Undo request sent...", 'wait');
        }
        
        handleUndoRequest() {
            this.ui.showModal({
                title: 'Undo Request',
                content: 'Your opponent wants to undo their last move. Do you agree?',
                buttons: [
                    { id: 'reject-undo', text: 'Reject', class: 'btn btn-secondary', callback: () => this.respondToUndo(false) },
                    { id: 'accept-undo', text: 'Accept', class: 'btn btn-primary', callback: () => this.respondToUndo(true) }
                ]
            });
        }

        respondToUndo(accepted) {
            this.network.publish('undo:response', { accepted });
            if (accepted) {
                // An "undo" reverts two half-moves (the opponent's move and your previous move)
                this.gameState.undoLastMove();
                this.gameState.undoLastMove();
                this.ui.renderBoard(this.gameState.board); // Full re-render after state change
                this.updateGameStatusUI();
            }
            this.ui.hideModal();
        }

        handleUndoResponse(accepted) {
            if (accepted) {
                this.ui.updateStatus('Opponent accepted undo.', 'info');
                this.gameState.undoLastMove();
                this.gameState.undoLastMove();
                this.ui.renderBoard(this.gameState.board);
            } else {
                this.ui.updateStatus('Opponent rejected undo.', 'info');
            }
            this.updateGameStatusUI();
        }
        
        confirmSurrender() {
            this.ui.showModal({
                title: 'Confirm Surrender',
                content: 'Are you sure you want to surrender? This will end the game.',
                buttons: [
                    { id: 'cancel-surrender', text: 'Cancel', class: 'btn btn-secondary', callback: () => this.ui.hideModal() },
                    { id: 'confirm-surrender', text: 'Surrender', class: 'btn btn-danger', callback: () => this.doSurrender() }
                ]
            });
        }
        
        doSurrender() {
            this.ui.hideModal();
            const winner = this.gameState.playerColor === 'red' ? 'black' : 'red';
            const gameOverState = { winner, reason: 'Surrender' };
            this.network.publish('game-over', gameOverState);
            this.endGame(winner, 'You surrendered.');
        }
    }

    // ===================================================================
    // # 3. Game Initialization
    // ===================================================================
    new GameController();
});