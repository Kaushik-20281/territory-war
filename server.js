const http = require("http");
const path = require("path");
const express = require("express");
const { WebSocketServer, WebSocket } = require("ws");

const app = express();
const server = http.createServer(app);
const webSockets = new WebSocketServer({ server });
const board = Array.from({ length: 10 }, () => Array(10).fill(0));
const players = [null, null];
let turn = 1;
let computerMode = false;
let computerTimer = null;

app.use(express.static(path.join(__dirname, "public")));

function sendState(client) {
  if (client.readyState === WebSocket.OPEN) {
    const scores = board.reduce((totals, row) => {
      row.forEach((owner) => {
        if (owner !== 0) totals[owner - 1] += 1;
      });
      return totals;
    }, [0, 0]);
    const gameOver = board.every((row) => row.every((owner) => owner !== 0));
    const winner = gameOver
      ? scores[0] === scores[1] ? 0 : scores[0] > scores[1] ? 1 : 2
      : null;

    client.send(JSON.stringify({
      type: "state",
      player: client.player,
      board,
      turn,
      scores,
      gameOver,
      winner,
      computerMode,
      playerTwoConnected: players[1] !== null
    }));
  }
}

function getCapturedCells(row, col, player) {
  const capturedCells = [];
  const directions = [[0, -1], [0, 1], [-1, 0], [1, 0]];

  directions.forEach(([rowStep, colStep]) => {
    const enemyCells = [];
    let nextRow = row + rowStep;
    let nextCol = col + colStep;

    while (
      nextRow >= 0 && nextRow < 10 &&
      nextCol >= 0 && nextCol < 10 &&
      board[nextRow][nextCol] === 3 - player
    ) {
      enemyCells.push([nextRow, nextCol]);
      nextRow += rowStep;
      nextCol += colStep;
    }

    if (
      enemyCells.length > 0 &&
      nextRow >= 0 && nextRow < 10 &&
      nextCol >= 0 && nextCol < 10 &&
      board[nextRow][nextCol] === player
    ) {
      capturedCells.push(...enemyCells);
    }
  });

  return capturedCells;
}

function applyMove(row, col, player) {
  board[row][col] = player;
  getCapturedCells(row, col, player).forEach(([capturedRow, capturedCol]) => {
    board[capturedRow][capturedCol] = player;
  });
}

function playComputerMove() {
  computerTimer = null;
  if (!computerMode || turn !== 2 || board.every((row) => row.every((owner) => owner !== 0))) {
    return;
  }

  const emptyCells = [];
  let bestMoves = [];
  let mostCaptures = 0;

  board.forEach((row, rowIndex) => {
    row.forEach((owner, colIndex) => {
      if (owner !== 0) return;
      const move = [rowIndex, colIndex];
      emptyCells.push(move);
      const captureCount = getCapturedCells(rowIndex, colIndex, 2).length;
      if (captureCount > mostCaptures) {
        mostCaptures = captureCount;
        bestMoves = [move];
      } else if (captureCount === mostCaptures && captureCount > 0) {
        bestMoves.push(move);
      }
    });
  });

  const choices = mostCaptures > 0 ? bestMoves : emptyCells;
  const [row, col] = choices[Math.floor(Math.random() * choices.length)];
  applyMove(row, col, 2);
  turn = 1;
  broadcastState();
}

function scheduleComputerMove() {
  clearTimeout(computerTimer);
  if (computerMode && turn === 2 && board.some((row) => row.includes(0))) {
    computerTimer = setTimeout(playComputerMove, 1000);
  }
}

function broadcastState() {
  webSockets.clients.forEach(sendState);
}

webSockets.on("connection", (client) => {
  const slot = players[0] === null ? 0 : !computerMode && players[1] === null ? 1 : -1;
  client.player = slot === -1 ? null : slot + 1;

  if (client.player !== null) {
    players[client.player - 1] = client;
  }

  broadcastState();

  client.on("message", (rawMessage) => {
    let message;
    try {
      message = JSON.parse(rawMessage.toString());
    } catch {
      return;
    }

    if (message === null || typeof message !== "object") {
      return;
    }

    if (message.type === "mode") {
      if (
        client.player === 1 &&
        players[0] === client &&
        typeof message.computerMode === "boolean" &&
        board.every((row) => row.every((owner) => owner === 0)) &&
        (!message.computerMode || players[1] === null)
      ) {
        clearTimeout(computerTimer);
        computerTimer = null;
        computerMode = message.computerMode;
        broadcastState();
      }
      return;
    }

    if (message.type === "reset") {
      if (client.player !== null && players[client.player - 1] === client) {
        clearTimeout(computerTimer);
        computerTimer = null;
        board.forEach((row) => row.fill(0));
        turn = 1;
        broadcastState();
      }
      return;
    }

    if (
      message.type !== "move" ||
      board.every((row) => row.every((owner) => owner !== 0)) ||
      client.player === null ||
      players[client.player - 1] !== client ||
      turn !== client.player ||
      !Number.isInteger(message.row) ||
      !Number.isInteger(message.col) ||
      message.row < 0 || message.row >= 10 ||
      message.col < 0 || message.col >= 10 ||
      board[message.row][message.col] !== 0
    ) {
      return;
    }

    applyMove(message.row, message.col, client.player);
    turn = 3 - client.player;
    broadcastState();
    scheduleComputerMove();
  });

  client.on("close", () => {
    if (client.player !== null && players[client.player - 1] === client) {
      players[client.player - 1] = null;
    }
    broadcastState();
  });
});

const port = Number(process.env.PORT) || 3000;
server.listen(port, () => {
  console.log(`Territory War is running at http://localhost:${port}`);
});