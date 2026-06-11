const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Game state
const state = {
  calledWords: new Set(),
  players: {},  // socketId -> { name, card, marked, bingo }
  winners: []
};

const BUZZWORDS = [
  'Synergy', 'Omnichannel', 'Disruptive', 'Pivot', 'Agile',
  'KPI', 'ROI', 'Scalable', 'Data-driven', 'Growth hacking',
  'Leverage', 'Ecosystem', 'Holistic', 'Stakeholders', 'Bandwidth',
  'Paradigm shift', 'Circle back', 'Low-hanging fruit', 'Move the needle',
  'Deep dive', 'Pain points', 'Value proposition', 'Best practice',
  'Thought leader', 'Authentic', 'Storytelling', 'Engagement',
  'Conversion', 'Funnel', 'Touchpoints', 'Customer journey',
  'Brand DNA', 'Viral', 'Influencer', 'Content is king',
  'A/B test', 'Persona', 'North star metric', 'Tiger team',
  'Blue sky', 'Boil the ocean', 'Take offline', 'Action item'
];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateCard() {
  const words = shuffle(BUZZWORDS).slice(0, 24);
  // Insert FREE in middle (index 12)
  words.splice(12, 0, 'FREE');
  return words;
}

function checkBingo(card, marked) {
  const size = 5;
  const lines = [];
  // Rows
  for (let r = 0; r < size; r++) lines.push([0,1,2,3,4].map(c => r * size + c));
  // Cols
  for (let c = 0; c < size; c++) lines.push([0,1,2,3,4].map(r => r * size + c));
  // Diagonals
  lines.push([0,6,12,18,24]);
  lines.push([4,8,12,16,20]);
  return lines.some(line => line.every(i => marked.has(i)));
}

function getLeaderboard() {
  return Object.values(state.players)
    .map(p => ({ name: p.name, marked: p.marked.size, bingo: p.bingo }))
    .sort((a, b) => {
      if (a.bingo && !b.bingo) return -1;
      if (!a.bingo && b.bingo) return 1;
      return b.marked - a.marked;
    })
    .slice(0, 20);
}

io.on('connection', (socket) => {
  // Player joins
  socket.on('join', (name) => {
    const card = generateCard();
    const marked = new Set([12]); // FREE square pre-marked
    state.players[socket.id] = { name, card, marked, bingo: false };

    // Auto-mark any already-called words
    card.forEach((word, i) => {
      if (state.calledWords.has(word)) marked.add(i);
    });

    socket.emit('card', { card, marked: [...marked], calledWords: [...state.calledWords] });
    io.emit('leaderboard', getLeaderboard());
    io.emit('playerCount', Object.keys(state.players).length);
  });

  // Player marks a word
  socket.on('mark', (index) => {
    const player = state.players[socket.id];
    if (!player) return;
    const word = player.card[index];
    if (word === 'FREE') return;

    if (player.marked.has(index)) {
      player.marked.delete(index);
    } else {
      player.marked.add(index);
    }

    const hasBingo = checkBingo(player.card, player.marked);
    if (hasBingo && !player.bingo) {
      player.bingo = true;
      io.emit('bingoAlert', player.name);
    } else if (!hasBingo) {
      player.bingo = false;
    }

    socket.emit('marked', [...player.marked]);
    io.emit('leaderboard', getLeaderboard());
  });

  // Presenter calls a word
  socket.on('callWord', (word) => {
    state.calledWords.add(word);
    // Auto-mark for all players
    for (const [id, player] of Object.entries(state.players)) {
      const idx = player.card.indexOf(word);
      if (idx !== -1) {
        player.marked.add(idx);
        const hasBingo = checkBingo(player.card, player.marked);
        if (hasBingo && !player.bingo) {
          player.bingo = true;
          io.emit('bingoAlert', player.name);
        }
        io.to(id).emit('marked', [...player.marked]);
      }
    }
    io.emit('wordCalled', word);
    io.emit('calledWords', [...state.calledWords]);
    io.emit('leaderboard', getLeaderboard());
  });

  // Presenter resets game
  socket.on('resetGame', () => {
    state.calledWords.clear();
    state.winners = [];
    for (const player of Object.values(state.players)) {
      player.card = generateCard();
      player.marked = new Set([12]);
      player.bingo = false;
      player.marked.forEach(() => {});
    }
    for (const [id, player] of Object.entries(state.players)) {
      io.to(id).emit('card', { card: player.card, marked: [...player.marked], calledWords: [] });
    }
    io.emit('calledWords', []);
    io.emit('leaderboard', getLeaderboard());
    io.emit('gameReset');
  });

  socket.on('disconnect', () => {
    delete state.players[socket.id];
    io.emit('leaderboard', getLeaderboard());
    io.emit('playerCount', Object.keys(state.players).length);
  });
});

// Expose buzzwords for presenter
app.get('/api/buzzwords', (req, res) => res.json(BUZZWORDS));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🎉 Buzzword Bingo running at http://localhost:${PORT}`);
  console.log(`📺 Presenter view: http://localhost:${PORT}/presenter.html`);
  console.log(`🎮 Player view:    http://localhost:${PORT}/\n`);
});
