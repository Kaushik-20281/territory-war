const boardElement = document.querySelector("#board");
const statusElement = document.querySelector("#status");
const scoreOneElement = document.querySelector("#score-one");
const scoreTwoElement = document.querySelector("#score-two");
const scoreTwoLabelElement = document.querySelector("#score-two-label");
const modeToggleButton = document.querySelector("#mode-toggle");
const modeLabelElement = document.querySelector("#mode-label");
const resultElement = document.querySelector("#result");
const resultMessageElement = document.querySelector("#result-message");
const playAgainButton = document.querySelector("#play-again");
const gameElement = document.querySelector(".game");
const confettiCanvas = document.querySelector("#confetti");
const confettiContext = confettiCanvas.getContext("2d");
const cells = [];
let gameState = null;
let audioContext = null;
let confettiFrame = null;

for (let row = 0; row < 10; row += 1) {
  for (let col = 0; col < 10; col += 1) {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "cell";
    cell.setAttribute("role", "gridcell");
    cell.setAttribute("aria-label", `Row ${row + 1}, column ${col + 1}, empty`);
    cell.addEventListener("click", () => {
      if (gameState && gameState.player === gameState.turn && gameState.board[row][col] === 0) {
        unlockAudio();
        socket.send(JSON.stringify({ type: "move", row, col }));
      }
    });
    cells.push(cell);
    boardElement.append(cell);
  }
}

const socketProtocol = location.protocol === "https:" ? "wss:" : "ws:";
const socket = new WebSocket(`${socketProtocol}//${location.host}`);

modeToggleButton.addEventListener("click", () => {
  if (gameState && gameState.player === 1) {
    unlockAudio();
    socket.send(JSON.stringify({
      type: "mode",
      computerMode: !gameState.computerMode
    }));
  }
});

playAgainButton.addEventListener("click", () => {
  if (gameState && gameState.player !== null) {
    unlockAudio();
    socket.send(JSON.stringify({ type: "reset" }));
  }
});

socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.type !== "state") return;

  const previousState = gameState;
  gameState = message;
  playStateSounds(previousState, gameState);
  render(previousState && previousState.board);
});

socket.addEventListener("close", () => {
  statusElement.textContent = "Connection lost. Refresh to rejoin the game.";
  cells.forEach((cell) => { cell.disabled = true; });
});

socket.addEventListener("error", () => {
  statusElement.textContent = "Unable to connect to the game server.";
});

function render(previousBoard) {
  const roles = {
    1: "Player One (Blue)",
    2: gameState.computerMode ? "Computer (Red)" : "Player Two (Red)"
  };
  const turnName = roles[gameState.turn];
  const playerName = gameState.player === null ? "Spectator" : `You are ${roles[gameState.player]}`;
  statusElement.textContent = gameState.gameOver
    ? "Game complete."
    : gameState.computerMode && gameState.turn === 2
      ? "Computer is thinking..."
      : `${playerName}. ${turnName}'s turn.`;
  scoreOneElement.textContent = gameState.scores[0];
  scoreTwoElement.textContent = gameState.scores[1];
  scoreTwoLabelElement.textContent = gameState.computerMode ? "Computer" : "Player Two";
  modeToggleButton.textContent = gameState.computerMode ? "Use Two Players" : "Play vs Computer";
  modeToggleButton.setAttribute("aria-pressed", String(gameState.computerMode));
  modeToggleButton.disabled = gameState.player !== 1 ||
    gameState.board.some((row) => row.some((owner) => owner !== 0)) ||
    (!gameState.computerMode && gameState.playerTwoConnected);
  modeLabelElement.textContent = gameState.computerMode ? "Computer opponent" : "Two-player game";
  resultElement.hidden = !gameState.gameOver;
  playAgainButton.disabled = gameState.player === null;
  resultMessageElement.textContent = !gameState.gameOver
    ? ""
    : gameState.winner === 0
      ? "It's a tie!"
      : `${roles[gameState.winner].replace(/ \(.+\)$/, "")} wins!`;

  gameState.board.forEach((row, rowIndex) => {
    row.forEach((owner, colIndex) => {
      const cell = cells[rowIndex * 10 + colIndex];
      const ownerName = owner === 1 ? "Player One" : owner === 2 ? "Player Two" : "empty";
      const previousOwner = previousBoard ? previousBoard[rowIndex][colIndex] : owner;
      const classes = ["cell"];
      if (owner === 1) classes.push("cell--player-one");
      if (owner === 2) classes.push("cell--player-two");
      if (owner === 0) classes.push(gameState.turn === 1 ? "cell--turn-one" : "cell--turn-two");
      if (previousOwner === 0 && owner !== 0) classes.push("cell--new");
      if (previousOwner !== 0 && owner !== 0 && previousOwner !== owner) classes.push("cell--captured");
      cell.className = classes.join(" ");
      cell.disabled = gameState.gameOver || owner !== 0 || gameState.player !== gameState.turn;
      cell.setAttribute("aria-label", `Row ${rowIndex + 1}, column ${colIndex + 1}, ${ownerName}`);
    });
  });
}

function unlockAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  if (!audioContext) audioContext = new AudioContextClass();
  if (audioContext.state === "suspended") audioContext.resume();
}

function playTone(frequency, startTime, duration, waveType, volume) {
  if (!audioContext) return;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = waveType;
  oscillator.frequency.setValueAtTime(frequency, startTime);
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(volume, startTime + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration);
}

function playSound(type) {
  if (!audioContext || audioContext.state !== "running") return;
  const now = audioContext.currentTime;
  if (type === "claim") {
    playTone(560, now, 0.12, "sine", 0.045);
  } else if (type === "capture") {
    playTone(390, now, 0.18, "triangle", 0.05);
    playTone(590, now + 0.07, 0.2, "triangle", 0.035);
  } else {
    [523, 659, 784].forEach((frequency, index) => {
      playTone(frequency, now + index * 0.12, 0.34, "sine", 0.045);
    });
  }
}

function playStateSounds(previousState, nextState) {
  if (!previousState) return;
  let claimed = false;
  let captured = false;
  nextState.board.forEach((row, rowIndex) => {
    row.forEach((owner, colIndex) => {
      const previousOwner = previousState.board[rowIndex][colIndex];
      if (previousOwner === 0 && owner !== 0) claimed = true;
      if (previousOwner !== 0 && owner !== 0 && previousOwner !== owner) captured = true;
    });
  });
  if (claimed) playSound("claim");
  if (captured) playSound("capture");
  if (!previousState.gameOver && nextState.gameOver) {
    playSound("win");
    showConfetti();
  }
}

function showConfetti() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (confettiFrame !== null) cancelAnimationFrame(confettiFrame);

  const pixelRatio = window.devicePixelRatio || 1;
  confettiCanvas.width = Math.floor(window.innerWidth * pixelRatio);
  confettiCanvas.height = Math.floor(window.innerHeight * pixelRatio);
  confettiContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  const colors = ["#e9b84e", "#68aaff", "#ff877f", "#f1f2ed", "#72c7a1"];
  const particles = Array.from({ length: 110 }, () => ({
    x: Math.random() * window.innerWidth,
    y: -Math.random() * window.innerHeight * 0.35,
    size: 4 + Math.random() * 6,
    speed: 1.8 + Math.random() * 3.5,
    drift: (Math.random() - 0.5) * 1.8,
    rotation: Math.random() * Math.PI,
    spin: (Math.random() - 0.5) * 0.14,
    color: colors[Math.floor(Math.random() * colors.length)]
  }));
  const startTime = performance.now();

  const draw = (time) => {
    confettiContext.clearRect(0, 0, window.innerWidth, window.innerHeight);
    particles.forEach((particle) => {
      particle.y += particle.speed;
      particle.x += particle.drift;
      particle.rotation += particle.spin;
      confettiContext.save();
      confettiContext.translate(particle.x, particle.y);
      confettiContext.rotate(particle.rotation);
      confettiContext.fillStyle = particle.color;
      confettiContext.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size * 0.62);
      confettiContext.restore();
    });
    if (time - startTime < 2800) {
      confettiFrame = requestAnimationFrame(draw);
    } else {
      confettiContext.clearRect(0, 0, window.innerWidth, window.innerHeight);
      confettiFrame = null;
    }
  };

  confettiFrame = requestAnimationFrame(draw);
}