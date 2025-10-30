from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit, join_room, leave_room
import random
import string
import os
import eventlet

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*")

# Store active games
games = {}

# -------------------------------
# Helper functions
# -------------------------------
def generate_room_code(length=4):
    """Generate a unique 4-character room code."""
    characters = string.ascii_uppercase + string.digits
    while True:
        code = ''.join(random.choice(characters) for _ in range(length))
        if code not in games:
            return code

def init_game_board(room_code):
    """Initialize the cards, scores, and turn order for a new game."""
    game = games[room_code]
    symbols = ["🍎", "🍌", "🍇", "🍓", "🍒", "🍍", "🥝", "🍉"]
    game["cards"] = symbols * 2
    random.shuffle(game["cards"])
    game["flipped"] = [False] * len(game["cards"])
    game["scores"] = {p: 0 for p in game["players"]}
    game["turn_index"] = 0
    game["game_started"] = True

# -------------------------------
# Routes
# -------------------------------
@app.route('/')
def index():
    """Render the main HTML page."""
    return render_template('index.html')

# -------------------------------
# Socket Events
# -------------------------------

@socketio.on("create_game")
def handle_create(username):
    """Handle room creation by the first player."""
    room_code = generate_room_code()
    games[room_code] = {
        "players": [username],
        "cards": [],
        "flipped": [],
        "scores": {},
        "turn_index": 0,
        "sid_to_username": {request.sid: username},
        "game_started": False,
        "creator_sid": request.sid
    }
    join_room(room_code)
    emit("room_created", {"code": room_code, "username": username, "is_creator": True})


@socketio.on("join_game")
def handle_join(data):
    """Handle a player joining an existing room."""
    username = data["username"]
    room_code = data["code"].upper()

    if room_code not in games:
        emit("join_error", {"message": f"Room code '{room_code}' not found."})
        return

    game = games[room_code]
    if game["game_started"]:
        emit("join_error", {"message": "Game has already started."})
        return

    if username in game["players"]:
        emit("join_error", {"message": "Username already taken in this room."})
        return

    game["players"].append(username)
    game["sid_to_username"][request.sid] = username
    join_room(room_code)

    socketio.emit("player_joined", {
        "username": username,
        "players": game["players"],
        "is_creator": (request.sid == game["creator_sid"])
    }, to=room_code)


@socketio.on("start_game")
def handle_start_game(room_code):
    """Start the game when the creator initiates it."""
    game = games.get(room_code)
    if not game or request.sid != game.get("creator_sid"):
        return

    if len(game["players"]) < 2:
        emit("start_error", {"message": "You need at least 2 players to start the game."})
        return

    init_game_board(room_code)
    socketio.emit("start_game", {
        "cards": [""] * len(game["cards"]),
        "flipped": game["flipped"],
        "scores": game["scores"],
        "turn": game["players"][game["turn_index"]],
        "players": game["players"]
    }, to=room_code)


@socketio.on("flip_card")
def handle_flip(data):
    """Handle card flip event."""
    room_code = data["room_code"]
    index = data["index"]
    game = games.get(room_code)
    if not game:
        return

    current_player = game["players"][game["turn_index"]]
    if game["sid_to_username"].get(request.sid) != current_player:
        return

    if not game["flipped"][index]:
        game["flipped"][index] = True
        socketio.emit("update_board", {"flipped": [index], "cards": game["cards"]}, to=room_code)


@socketio.on("check_match")
def handle_check_match(data):
    """Check if two flipped cards are a match."""
    room_code = data["room_code"]
    indices = data["indices"]
    game = games.get(room_code)
    if not game:
        return

    current_player = game["players"][game["turn_index"]]
    if game["sid_to_username"].get(request.sid) != current_player:
        return

    i1, i2 = indices
    match = game["cards"][i1] == game["cards"][i2]
    player = current_player

    if match:
        game["scores"][player] += 1
        socketio.emit("match_result", {
            "match": True,
            "indices": [i1, i2],
            "scores": game["scores"],
            "turn": player
        }, to=room_code)

        if all(game["flipped"]):
            winner = max(game["scores"], key=game["scores"].get)
            socketio.emit("game_over", {"winner": winner, "scores": game["scores"]}, to=room_code)
            return

        socketio.emit("turn_update", player, to=room_code)
        socketio.emit("timer_reset", to=room_code)

    else:
        game["flipped"][i1] = False
        game["flipped"][i2] = False
        game["turn_index"] = (game["turn_index"] + 1) % len(game["players"])
        next_player = game["players"][game["turn_index"]]
        socketio.emit("match_result", {
            "match": False,
            "indices": [i1, i2],
            "scores": game["scores"],
            "turn": next_player
        }, to=room_code)
        socketio.emit("turn_update", next_player, to=room_code)
        socketio.emit("timer_reset", to=room_code)


@socketio.on("chat_message")
def handle_chat(data):
    """Handle real-time chat messages."""
    room_code = data["room_code"]
    message = data["message"]
    game = games.get(room_code)
    if not game:
        return

    username = game["sid_to_username"].get(request.sid, "Guest")
    socketio.emit("chat_message", {"username": username, "message": message}, to=room_code)


@socketio.on("disconnect")
def handle_disconnect():
    """Handle when a player disconnects from the room."""
    for code, game in list(games.items()):
        if request.sid in game.get("sid_to_username", {}):
            username = game["sid_to_username"].pop(request.sid)
            if username in game["players"]:
                game["players"].remove(username)
            leave_room(code)
            if not game["players"]:
                del games[code]
            else:
                socketio.emit("player_left", {"username": username, "players": game["players"]}, to=code)
            break


# -------------------------------
# Run the app (for local & Render)G
# -------------------------------
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    socketio.run(app, host="0.0.0.0", port=port)
