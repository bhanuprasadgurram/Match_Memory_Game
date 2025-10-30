const socket = io();

let username = "";
let roomCode = "";
let myTurn = false;
let timerInterval;
let time = 0;
let isCreator = false;
let firstCard = null;
let lockBoard = false;

// =========================
//  BUTTON ACTIONS
// =========================
document.getElementById("create-btn").addEventListener("click", () => {
    username = document.getElementById("username").value.trim();
    if (!username) return alert("Please enter a name!");
    socket.emit("create_game", username);
});

document.getElementById("join-btn").addEventListener("click", () => {
    username = document.getElementById("username").value.trim();
    roomCode = document.getElementById("room-code-input").value.trim().toUpperCase();
    if (!username || !roomCode) return alert("Enter name & room code!");
    socket.emit("join_game", { username, code: roomCode });
});

document.getElementById("start-game-btn").addEventListener("click", () => {
    if (isCreator && roomCode) socket.emit("start_game", roomCode);
});

document.getElementById("send-chat").addEventListener("click", () => {
    const msg = document.getElementById("chat-input").value.trim();
    if (msg && roomCode) {
        socket.emit("chat_message", { room_code: roomCode, message: msg });
        document.getElementById("chat-input").value = "";
    }
});

// =========================
//  SOCKET EVENTS
// =========================
socket.on("room_created", (data) => {
    roomCode = data.code;
    isCreator = data.is_creator;
    document.getElementById("room-code-display").textContent = roomCode;
    document.getElementById("player-setup").classList.add("hidden");
    document.getElementById("room-info").classList.remove("hidden");
    updatePlayerList([username]);
});

socket.on("player_joined", (data) => {
    document.getElementById("player-setup").classList.add("hidden");
    document.getElementById("room-info").classList.remove("hidden");
    document.getElementById("room-code-display").textContent = roomCode || data.roomCode;
    updatePlayerList(data.players);
    if (data.players.length >= 2 && isCreator)
        document.getElementById("start-game-btn").classList.remove("hidden");
});

socket.on("start_game", (data) => {
    document.getElementById("room-info").classList.add("hidden");
    document.getElementById("game-area").classList.remove("hidden");
    createBoard(data.cards, data.flipped);
    updateScores(data.scores);
    updateTurn(data.turn);
    // ensure board unlocked at start
    lockBoard = false;
});

socket.on("update_board", (data) => {
    const cards = document.querySelectorAll(".card");
    data.flipped.forEach(index => {
        const card = cards[index];
        card.classList.add("flipped");
        card.innerHTML = `<span class="symbol">${data.cards[index]}</span>`;
    });
});

socket.on("match_result", (data) => {
    const cards = document.querySelectorAll(".card");

    if (data.match) {
        data.indices.forEach(i => {
            const card = cards[i];
            card.classList.add("matched");
            card.classList.add("flipped");
            card.innerHTML = `<span class="symbol">${card.dataset.symbol}</span>`;
        });

        // important: unlock the board so the matching player can continue
        lockBoard = false;

    } else {
        // Flip back non-matching cards after delay
        setTimeout(() => {
            data.indices.forEach(i => {
                const card = cards[i];
                if (!card.classList.contains("matched")) {
                    card.classList.remove("flipped");
                    card.innerHTML = "";
                }
            });
            lockBoard = false;
        }, 800);
    }

    updateScores(data.scores);
    updateTurn(data.turn);
});

socket.on("chat_message", (data) => {
    const chatBox = document.getElementById("chat-box");
    const div = document.createElement("div");
    div.classList.add("chat-message", data.username === username ? "self" : "other");
    div.innerHTML = `<div class="chat-bubble"><b>${data.username}:</b> ${data.message}</div>`;
    chatBox.appendChild(div);
    chatBox.scrollTop = chatBox.scrollHeight;
});

socket.on("turn_update", (turnPlayer) => updateTurn(turnPlayer));
socket.on("timer_reset", () => resetTimer());

// 🎯 When game finishes
socket.on("game_over", (data) => {
    setTimeout(() => {
        alert(`🏁 Game Over!\nWinner: ${data.winner}\n\nScores:\n` +
            Object.entries(data.scores).map(([p, s]) => `${p}: ${s}`).join("\n"));
        location.reload();
    }, 500);
});

// =========================
//  FUNCTIONS
// =========================
function updatePlayerList(players) {
    const listDiv = document.getElementById("player-list");
    listDiv.innerHTML = "<b>Players in room:</b> " + players.join(", ");
    document.getElementById("waiting-message").textContent =
        players.length < 2 ? "Need at least 2 players." : "Ready to start!";
}

function createBoard(cards, flippedState) {
    const board = document.getElementById("board");
    board.innerHTML = "";
    cards.forEach((symbol, index) => {
        const card = document.createElement("div");
        card.classList.add("card");
        card.dataset.index = index;
        card.dataset.symbol = symbol;
        if (flippedState[index]) {
            card.classList.add("flipped");
            card.innerHTML = `<span class="symbol">${symbol}</span>`;
        }
        card.addEventListener("click", () => handleCardClick(card));
        board.appendChild(card);
    });
    // ensure state variables reset appropriately
    firstCard = null;
    lockBoard = false;
}

function handleCardClick(card) {
    if (!myTurn || lockBoard) return;
    if (card.classList.contains("flipped") || card.classList.contains("matched")) return;

    const index = parseInt(card.dataset.index);
    socket.emit("flip_card", { index, room_code: roomCode });

    card.classList.add("flipped");
    card.innerHTML = `<span class="symbol">${card.dataset.symbol}</span>`;

    if (!firstCard) {
        firstCard = card;
    } else {
        lockBoard = true;
        setTimeout(() => {
            socket.emit("check_match", {
                indices: [parseInt(firstCard.dataset.index), index],
                room_code: roomCode
            });
            firstCard = null;
            // don't set lockBoard=false here; it will be cleared when server responds
        }, 700);
    }
}

function updateTurn(turnPlayer) {
    const turnDiv = document.getElementById("turn");
    if (turnPlayer === username) {
        turnDiv.textContent = `Your Turn ⏳`;
        myTurn = true;
        startTimer();
    } else {
        turnDiv.textContent = `${turnPlayer}'s Turn`;
        myTurn = false;
        stopTimer();
    }
}

function updateScores(scores) {
    document.getElementById("scores").innerHTML =
        "<b>Scores:</b><br>" + Object.entries(scores).map(([p, s]) => `${p}: ${s}`).join("<br>");
}

function startTimer() {
    stopTimer();
    time = 0;
    timerInterval = setInterval(() => {
        time++;
        document.getElementById("timer-value").textContent = time;
    }, 1000);
}

function stopTimer() {
    if (timerInterval) clearInterval(timerInterval);
}

function resetTimer() {
    stopTimer();
    time = 0;
    document.getElementById("timer-value").textContent = time;
}
