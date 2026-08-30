// Alpha Gambles Bankroll Manager Logic

// State management
let state = {
  gameId: null,
  status: 'SETUP', // 'SETUP', 'ACTIVE', 'GAMEOVER'
  createdAt: null,
  startingBalance: 1000,
  bootAmount: 100,
  initialPlayerCount: 4,
  players: [], // Array of player names
  transactions: [], // Array of transaction objects: { id, timestamp, from, to, amount, reason, groupId }
  roundsCount: 0,
  eliminatedPlayerPending: null // Used to track player pending elimination decision
};

// UI Elements
const setupScreen = document.getElementById('setupScreen');
const gameplayDashboard = document.getElementById('gameplayDashboard');
const gameOverScreen = document.getElementById('gameOverScreen');
const statusBar = document.getElementById('statusBar');

const playerNamesContainer = document.getElementById('playerNamesContainer');
const playerCountInput = document.getElementById('playerCount');
const startingBalanceInput = document.getElementById('startingBalance');
const bootAmountInput = document.getElementById('bootAmount');

// Initialize on page load
window.addEventListener('DOMContentLoaded', () => {
  loadGame();
  if (state.status === 'SETUP') {
    renderPlayerInputs();
  } else {
    refreshUI();
  }
});

// Save and Load helper
function saveGame() {
  localStorage.setItem('tp_bankroll_state', JSON.stringify(state));
}

function loadGame() {
  const saved = localStorage.getItem('tp_bankroll_state');
  if (saved) {
    try {
      state = JSON.parse(saved);
      if (!state.startingBalance && state.buyInAmount) {
        state.startingBalance = state.buyInAmount;
      }
      if (!state.bootAmount) {
        state.bootAmount = 100;
      }
    } catch (e) {
      console.error("Failed to parse saved state", e);
    }
  }
}

// Adjust player count in setup screen
function adjustPlayerCount(val) {
  let count = parseInt(playerCountInput.value) + val;
  if (count >= 2 && count <= 10) {
    playerCountInput.value = count;
    state.initialPlayerCount = count;
    renderPlayerInputs();
  }
}

// Render dynamic player input fields in setup
function renderPlayerInputs() {
  const count = parseInt(playerCountInput.value);
  playerNamesContainer.innerHTML = '';
  for (let i = 1; i <= count; i++) {
    const div = document.createElement('div');
    div.className = 'form-group';
    div.innerHTML = `
      <input type="text" class="player-name-input" placeholder="Player ${i} Name" value="${getSavedName(i-1) || 'Player ' + i}" required>
    `;
    playerNamesContainer.appendChild(div);
  }
}

function getSavedName(index) {
  if (state.players && state.players[index]) {
    return state.players[index];
  }
  return '';
}

// Start a new session
document.getElementById('setupForm').addEventListener('submit', (e) => {
  e.preventDefault();
  
  const startingBal = parseInt(document.getElementById('startingBalance').value);
  const bootAmt = parseInt(document.getElementById('bootAmount').value);

  if (isNaN(startingBal) || startingBal <= 0) {
    alert("Starting balance must be greater than zero.");
    return;
  }
  if (isNaN(bootAmt) || bootAmt <= 0) {
    alert("Round buy-in / boot amount must be greater than zero.");
    return;
  }
  if (bootAmt > startingBal) {
    alert("Boot amount cannot exceed starting balance.");
    return;
  }

  // Get names
  const inputs = document.querySelectorAll('.player-name-input');
  const names = [];
  const nameSet = new Set();

  for (let input of inputs) {
    const name = input.value.trim();
    if (!name) {
      alert("All players must have a name.");
      return;
    }
    if (name.toLowerCase() === 'bank' || name.toLowerCase() === 'system' || name.toLowerCase() === 'external') {
      alert("Name 'Bank', 'System', or 'External' is reserved.");
      return;
    }
    if (nameSet.has(name.toLowerCase())) {
      alert("Player names must be unique.");
      return;
    }
    nameSet.add(name.toLowerCase());
    names.push(name);
  }

  // Initialize state
  state.gameId = 'game_' + Date.now();
  state.status = 'ACTIVE';
  state.createdAt = Date.now();
  state.startingBalance = startingBal;
  state.bootAmount = bootAmt;
  state.players = names;
  state.transactions = [];
  state.roundsCount = 0;
  state.eliminatedPlayerPending = null;

  // Record initial buy-in transactions: External -> Player
  const initGroupId = 'init_' + Date.now();
  names.forEach(name => {
    state.transactions.push({
      id: 'tx_' + Math.random().toString(36).substr(2, 9),
      timestamp: Date.now(),
      from: 'External',
      to: name,
      amount: startingBal,
      reason: 'Initial Bankroll',
      groupId: initGroupId
    });
  });

  saveGame();
  const roundBootInputElem = document.getElementById('roundBootInput');
  if (roundBootInputElem) {
    roundBootInputElem.value = bootAmt;
  }
  refreshUI();
});

// Derived Balances Engine
function deriveBalances() {
  const balances = {
    bank: 0,
    players: {}
  };

  state.players.forEach(p => {
    balances.players[p] = 0;
  });

  state.transactions.forEach(tx => {
    // Deduct from sender
    if (tx.from === 'Bank') {
      balances.bank -= tx.amount;
    } else if (balances.players[tx.from] !== undefined) {
      balances.players[tx.from] -= tx.amount;
    }

    // Add to receiver
    if (tx.to === 'Bank') {
      balances.bank += tx.amount;
    } else if (balances.players[tx.to] !== undefined) {
      balances.players[tx.to] += tx.amount;
    }
  });

  return balances;
}

// Calculate Current Round Pot Breakdown
function getCurrentRoundPotInfo() {
  const currentRoundNum = state.roundsCount + 1;
  let bootTotal = 0;
  let hitsTotal = 0;
  const playerContributions = {};
  state.players.forEach(p => playerContributions[p] = 0);

  state.transactions.forEach(tx => {
    if (tx.to === 'Bank') {
      if (tx.reason === `Round ${currentRoundNum} Boot`) {
        bootTotal += tx.amount;
        if (playerContributions[tx.from] !== undefined) {
          playerContributions[tx.from] += tx.amount;
        }
      } else if (tx.reason.startsWith(`Round ${currentRoundNum} Hit`)) {
        hitsTotal += tx.amount;
        if (playerContributions[tx.from] !== undefined) {
          playerContributions[tx.from] += tx.amount;
        }
      }
    }
  });

  return {
    roundNumber: currentRoundNum,
    bootTotal,
    hitsTotal,
    totalPot: bootTotal + hitsTotal,
    playerContributions
  };
}

// Transaction generator with validation
function executeTransaction({ from, to, amount, reason, groupId }) {
  if (amount <= 0) {
    throw new Error("Transaction amount must be greater than zero.");
  }
  
  // Hypothetical validation
  const tempTransactions = [...state.transactions, { from, to, amount }];
  const tempBalances = { bank: 0, players: {} };
  state.players.forEach(p => tempBalances.players[p] = 0);
  
  tempTransactions.forEach(tx => {
    if (tx.from === 'Bank') tempBalances.bank -= tx.amount;
    else if (tempBalances.players[tx.from] !== undefined) tempBalances.players[tx.from] -= tx.amount;

    if (tx.to === 'Bank') tempBalances.bank += tx.amount;
    else if (tempBalances.players[tx.to] !== undefined) tempBalances.players[tx.to] += tx.amount;
  });

  // Validation: Check negative balances
  if (from !== 'External' && from !== 'Bank' && tempBalances.players[from] < 0) {
    throw new Error(`Insufficient funds: ${from} does not have ₹${amount}. (Balance: ₹${tempBalances.players[from] + amount})`);
  }
  if (from === 'Bank' && tempBalances.bank < 0) {
    throw new Error(`Insufficient funds in the Bank.`);
  }

  // Push validated transaction
  const newTx = {
    id: 'tx_' + Math.random().toString(36).substr(2, 9),
    timestamp: Date.now(),
    from,
    to,
    amount,
    reason,
    groupId: groupId || 'gp_' + Date.now()
  };
  state.transactions.push(newTx);
  return newTx;
}

// Refresh UI Elements
let lastBalances = null;

function refreshUI() {
  if (state.status === 'SETUP') {
    setupScreen.style.display = 'block';
    gameplayDashboard.style.display = 'none';
    gameOverScreen.style.display = 'none';
    statusBar.style.display = 'none';
    return;
  }

  setupScreen.style.display = 'none';
  statusBar.style.display = 'flex';

  const derived = deriveBalances();

  if (state.status === 'GAMEOVER') {
    gameplayDashboard.style.display = 'none';
    gameOverScreen.style.display = 'block';
    document.getElementById('statusText').innerText = 'GAME OVER';
    document.getElementById('statusBar').querySelector('.status-dot').className = 'status-dot red';
    renderGameOver(derived, state.eliminatedPlayerPending);
    return;
  }

  // Active game UI refresh
  gameplayDashboard.style.display = 'block';
  gameOverScreen.style.display = 'none';
  document.getElementById('statusText').innerText = 'ACTIVE';
  document.getElementById('statusBar').querySelector('.status-dot').className = 'status-dot green';

  // Bank display
  document.getElementById('bankBalance').innerText = `₹${derived.bank.toLocaleString('en-IN')}`;

  // Active players count (players who have > 0 balance OR have chips in the current round pot)
  const potInfo = getCurrentRoundPotInfo();
  let activeCount = 0;
  state.players.forEach(p => {
    if (derived.players[p] > 0 || (potInfo.playerContributions[p] && potInfo.playerContributions[p] > 0)) {
      activeCount++;
    }
  });
  document.getElementById('activePlayersCount').innerText = activeCount;

  // System total calculation & display
  const totalPlayersMoney = Object.values(derived.players).reduce((a, b) => a + b, 0);
  const totalSystemMoney = totalPlayersMoney + derived.bank;
  document.getElementById('systemTotal').innerText = `₹${totalSystemMoney.toLocaleString('en-IN')}`;

  // Current Pot calculation & display
  document.getElementById('currentRoundLabel').innerText = `Round ${potInfo.roundNumber} Pot`;
  document.getElementById('roundBadge').innerText = `Round ${potInfo.roundNumber}`;
  document.getElementById('currentPotDisplay').innerText = `₹${potInfo.totalPot.toLocaleString('en-IN')}`;
  document.getElementById('potBootAmt').innerText = `₹${potInfo.bootTotal.toLocaleString('en-IN')}`;
  document.getElementById('potHitsAmt').innerText = `₹${potInfo.hitsTotal.toLocaleString('en-IN')}`;

  // Update Boot Controls
  const bootInput = document.getElementById('roundBootInput');
  if (bootInput) {
    if (!bootInput.value || parseInt(bootInput.value) <= 0 || (potInfo.bootTotal === 0 && !bootInput.dataset.userEdited)) {
      bootInput.value = state.bootAmount;
    }
  }
  updateBootButtonText();

  // Check for All-in players in current round
  const allInPlayers = [];
  state.players.forEach(p => {
    if (derived.players[p] === 0 && (potInfo.playerContributions[p] > 0 || potInfo.totalPot === 0)) {
      allInPlayers.push(p);
    }
  });

  const allInNotice = document.getElementById('allInNotice');
  if (allInNotice) {
    if (allInPlayers.length > 0) {
      allInNotice.style.display = 'flex';
      allInNotice.innerHTML = `🚨 <b>${allInPlayers.join(', ')}</b> bet all money (₹0). Active in showdown!`;
    } else {
      allInNotice.style.display = 'none';
    }
  }

  // Update Award Pot Button
  const btnAwardPot = document.getElementById('btnAwardPot');
  if (btnAwardPot) {
    btnAwardPot.innerText = `🏆 Award Entire Pot (₹${potInfo.totalPot.toLocaleString('en-IN')}) to Winner`;
    btnAwardPot.disabled = potInfo.totalPot <= 0;
  }

  // Render player cards
  renderPlayerCards(derived, potInfo);

  // Render Pitch Hits List
  renderPitchHitsList(derived, potInfo);

  // Populate interactive selectors
  populateSelectors(derived, potInfo);

  // Render ledger list
  renderLedger();

  // Highlight balance changes
  if (lastBalances) {
    highlightChanges(derived, lastBalances);
  }
  lastBalances = derived;
}

// Render player cards list
function renderPlayerCards(derived, potInfo) {
  const grid = document.getElementById('playersGrid');
  grid.innerHTML = '';

  state.players.forEach(name => {
    const bal = derived.players[name];
    const card = document.createElement('div');
    card.className = `player-card glass-panel`;
    card.id = `player-card-${name.replace(/\s+/g, '_')}`;

    // Net win/loss calculation
    const diff = bal - state.startingBalance;
    let diffText = '₹0';
    let diffClass = '';
    if (diff > 0) {
      diffText = `+₹${diff.toLocaleString('en-IN')}`;
      diffClass = 'positive';
    } else if (diff < 0) {
      diffText = `-₹${Math.abs(diff).toLocaleString('en-IN')}`;
      diffClass = 'negative';
    }

    const pitchedThisRound = (potInfo && potInfo.playerContributions[name]) || 0;

    // Status Badge determination
    let badgeClass = 'badge-active';
    let badgeLabel = 'Active';

    if (bal === 0) {
      badgeClass = 'badge-allin';
      badgeLabel = 'All-In (₹0)';
    }

    card.innerHTML = `
      <div class="player-identity">
        <span class="player-name">${name}</span>
        <span class="player-status-badge ${badgeClass}">
          ${badgeLabel}
        </span>
        <span style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.2rem;">
          In Pot: <strong style="color: var(--accent-gold);">₹${pitchedThisRound.toLocaleString('en-IN')}</strong>
        </span>
      </div>
      <div class="player-financials">
        <div class="player-round-change ${diffClass}">${diffText}</div>
        <div class="player-balance" id="bal-${name.replace(/\s+/g, '_')}">₹${bal.toLocaleString('en-IN')}</div>
      </div>
    `;
    grid.appendChild(card);
  });
}

// Render Pitch Hits List for Step 2
function renderPitchHitsList(derived, potInfo) {
  const container = document.getElementById('pitchHitsList');
  container.innerHTML = '';

  state.players.forEach(p => {
    const bal = derived.players[p];
    const item = document.createElement('div');
    item.className = 'pitch-player-item';
    const inPot = (potInfo && potInfo.playerContributions[p]) || 0;

    if (bal > 0) {
      item.innerHTML = `
        <div class="pitch-player-info">
          <span class="pitch-player-name">${p}</span>
          <span class="pitch-player-stat">Bal: ₹${bal.toLocaleString('en-IN')} | In Pot: ₹${inPot}</span>
        </div>
        <div class="pitch-player-actions">
          <button class="quick-chip-btn" onclick="pitchHit('${p}', 20)">+₹20</button>
          <button class="quick-chip-btn" onclick="pitchHit('${p}', 50)">+₹50</button>
          <button class="quick-chip-btn" onclick="pitchHit('${p}', 100)">+₹100</button>
          <button class="quick-chip-btn" onclick="pitchHit('${p}', 200)">+₹200</button>
          <div class="custom-pitch-group">
            <input type="number" id="customHit-${p.replace(/\s+/g, '_')}" placeholder="₹" min="1" class="custom-pitch-input">
            <button class="btn btn-xs btn-outline btn-gold" onclick="pitchCustomHit('${p}')">Hit</button>
          </div>
        </div>
      `;
    } else {
      item.innerHTML = `
        <div class="pitch-player-info">
          <span class="pitch-player-name">${p}</span>
          <span class="pitch-player-stat" style="color: #f39c12; font-weight: 600;">ALL-IN (₹0 remaining) | In Pot: ₹${inPot}</span>
        </div>
        <div class="pitch-player-actions">
          <span style="font-size: 0.75rem; color: var(--text-muted);">Awaiting Showdown</span>
        </div>
      `;
    }
    container.appendChild(item);
  });
}

// Dynamic Boot button label updater
function updateBootButtonText() {
  const bootInput = document.getElementById('roundBootInput');
  const btnCollectBoot = document.getElementById('btnCollectBoot');
  const bootStatusMessage = document.getElementById('bootStatusMessage');
  if (!bootInput || !btnCollectBoot) return;

  const currentBootVal = parseInt(bootInput.value) || state.bootAmount || 100;
  const potInfo = getCurrentRoundPotInfo();

  if (potInfo.bootTotal > 0) {
    btnCollectBoot.innerHTML = `⚡ Collect Extra Boot (₹${currentBootVal} from All)`;
    btnCollectBoot.classList.remove('btn-gold');
    btnCollectBoot.classList.add('btn-outline');
    if (bootStatusMessage) bootStatusMessage.innerHTML = `✔ Boot Active: ₹${potInfo.bootTotal.toLocaleString('en-IN')} deposited in Bank/Pot.`;
  } else {
    btnCollectBoot.innerHTML = `⚡ Deduct Boot (₹${currentBootVal} from All) &rarr; Bank`;
    btnCollectBoot.classList.remove('btn-outline');
    btnCollectBoot.classList.add('btn-gold');
    if (bootStatusMessage) bootStatusMessage.innerHTML = ``;
  }
}

// Action: Collect Boot from all active players into Bank
function collectBootFromAll() {
  const bootAmtInput = document.getElementById('roundBootInput');
  const bootAmt = parseInt(bootAmtInput.value);

  if (isNaN(bootAmt) || bootAmt <= 0) {
    alert("Boot amount must be greater than zero.");
    return;
  }

  const derived = deriveBalances();
  const currentRoundNum = state.roundsCount + 1;
  const groupId = `round_${currentRoundNum}_boot_${Date.now()}`;
  const txsToRun = [];

  try {
    for (let p of state.players) {
      if (derived.players[p] > 0) {
        const actualAmt = Math.min(bootAmt, derived.players[p]);
        txsToRun.push({
          from: p,
          to: 'Bank',
          amount: actualAmt,
          reason: `Round ${currentRoundNum} Boot`,
          groupId
        });
      }
    }

    if (txsToRun.length === 0) {
      alert("No players with available balance to collect boot from.");
      return;
    }

    // Execute all boot transactions atomically
    txsToRun.forEach(tx => executeTransaction(tx));
    saveGame();
    refreshUI();
  } catch (err) {
    alert("Failed to collect boot: " + err.message);
  }
}

// Action: Pitch Hit for a single player
function pitchHit(playerName, amount) {
  if (isNaN(amount) || amount <= 0) {
    alert("Hit amount must be greater than zero.");
    return;
  }

  const currentRoundNum = state.roundsCount + 1;
  const groupId = `round_${currentRoundNum}_hit_${Date.now()}`;

  try {
    executeTransaction({
      from: playerName,
      to: 'Bank',
      amount: amount,
      reason: `Round ${currentRoundNum} Hit: ${playerName}`,
      groupId
    });
    saveGame();
    refreshUI();
  } catch (err) {
    alert(err.message);
  }
}

function pitchCustomHit(playerName) {
  const input = document.getElementById(`customHit-${playerName.replace(/\s+/g, '_')}`);
  const amount = parseInt(input.value);
  if (isNaN(amount) || amount <= 0) {
    alert("Please enter a valid hit amount.");
    return;
  }
  pitchHit(playerName, amount);
  input.value = '';
}

// Action: Award Pot to Winner and handle potential eliminations
function awardPotToWinner() {
  const winner = document.getElementById('roundWinnerSelect').value;
  if (!winner) {
    alert("Please select a winner.");
    return;
  }

  const potInfo = getCurrentRoundPotInfo();
  if (potInfo.totalPot <= 0) {
    alert("The pot is currently empty (₹0). Please collect boot or pitch hits first.");
    return;
  }

  const currentRoundNum = state.roundsCount + 1;
  const groupId = `round_${currentRoundNum}_award_${Date.now()}`;

  try {
    // Transfer total pot from Bank -> Winner
    executeTransaction({
      from: 'Bank',
      to: winner,
      amount: potInfo.totalPot,
      reason: `Round ${currentRoundNum} Winner: ${winner}`,
      groupId
    });

    state.roundsCount++;

    // Check if any player ends with ₹0 balance after this round (e.g. an all-in player who didn't win)
    const updatedBalances = deriveBalances();
    const zeroBalancePlayers = state.players.filter(p => updatedBalances.players[p] === 0);

    if (zeroBalancePlayers.length > 0) {
      state.status = 'GAMEOVER';
      state.eliminatedPlayerPending = zeroBalancePlayers[0];
    }

    saveGame();
    refreshUI();
  } catch (err) {
    alert("Failed to award pot: " + err.message);
  }
}

// ADMIN ADD MONEY (Direct - No password needed)
function openAdminAddMoneyModal(preselectedPlayer) {
  const targetSelect = document.getElementById('adminTargetPlayer');
  targetSelect.innerHTML = '';

  state.players.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.innerText = `Player: ${p}`;
    if (preselectedPlayer && p === preselectedPlayer) opt.selected = true;
    targetSelect.appendChild(opt);
  });

  // Also allow adding directly to Bank
  const bankOpt = document.createElement('option');
  bankOpt.value = 'Bank';
  bankOpt.innerText = 'Central Bank';
  if (preselectedPlayer === 'Bank') bankOpt.selected = true;
  targetSelect.appendChild(bankOpt);

  document.getElementById('adminAddMoneyModal').classList.add('active');
}

function closeAdminAddMoneyModal() {
  document.getElementById('adminAddMoneyModal').classList.remove('active');
}

function submitAdminAddMoney() {
  const target = document.getElementById('adminTargetPlayer').value;
  const amt = parseInt(document.getElementById('adminAddAmount').value);

  if (isNaN(amt) || amt <= 0) {
    alert("Amount must be greater than zero.");
    return;
  }

  try {
    executeTransaction({
      from: 'External',
      to: target,
      amount: amt,
      reason: `Admin Addition: ${target}`
    });

    closeAdminAddMoneyModal();
    saveGame();
    refreshUI();
  } catch (err) {
    alert(err.message);
  }
}

// Flash visual cues on balance changes
function highlightChanges(current, last) {
  state.players.forEach(p => {
    const key = p.replace(/\s+/g, '_');
    const elem = document.getElementById(`bal-${key}`);
    if (elem) {
      const curBal = current.players[p];
      const prevBal = last.players[p];
      if (curBal > prevBal) {
        elem.classList.add('flash-up');
        setTimeout(() => elem.classList.remove('flash-up'), 1500);
      } else if (curBal < prevBal) {
        elem.classList.add('flash-down');
        setTimeout(() => elem.classList.remove('flash-down'), 1500);
      }
    }
  });
}

// Populate drop-downs dynamically
function populateSelectors(derived, potInfo) {
  const winnerSelect = document.getElementById('roundWinnerSelect');
  const prevSelected = winnerSelect.value;
  winnerSelect.innerHTML = '';
  
  state.players.forEach(p => {
    if (derived.players[p] > 0 || (potInfo && potInfo.playerContributions[p] > 0)) {
      const opt = document.createElement('option');
      opt.value = p;
      opt.innerText = `${p} ${derived.players[p] === 0 ? '(All-In)' : ''}`;
      if (p === prevSelected) opt.selected = true;
      winnerSelect.appendChild(opt);
    }
  });
}

// Render ledger
function renderLedger() {
  const tbody = document.getElementById('ledgerHistory');
  tbody.innerHTML = '';

  const btnUndo = document.getElementById('btnUndo');
  btnUndo.disabled = state.transactions.length === 0;

  // Show latest transactions first
  const reversed = [...state.transactions].reverse();
  reversed.forEach(tx => {
    const row = document.createElement('tr');
    const time = new Date(tx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    row.innerHTML = `
      <td>${time}</td>
      <td>${tx.from}</td>
      <td>${tx.to}</td>
      <td class="col-amt font-highlight">₹${tx.amount.toLocaleString('en-IN')}</td>
      <td>${tx.reason}</td>
    `;
    tbody.appendChild(row);
  });
}

// Undo Last action group
function undoLastTransaction() {
  if (state.transactions.length === 0) return;

  if (confirm("Are you sure you want to undo the last transaction/action?")) {
    const lastTx = state.transactions[state.transactions.length - 1];
    const targetGroupId = lastTx.groupId;

    state.transactions = state.transactions.filter(tx => tx.groupId !== targetGroupId);

    if (targetGroupId && targetGroupId.includes('_award_')) {
      state.roundsCount = Math.max(0, state.roundsCount - 1);
    }

    if (state.status === 'GAMEOVER') {
      state.status = 'ACTIVE';
    }

    saveGame();
    refreshUI();
  }
}

// Reset/Restart Setup Confirm
document.getElementById('btnNewGameHeader').addEventListener('click', () => {
  if (confirm("Are you sure you want to discard the current game and start a new session?")) {
    restartSetup();
  }
});

function restartSetup() {
  state.status = 'SETUP';
  state.transactions = [];
  state.roundsCount = 0;
  state.eliminatedPlayerPending = null;
  saveGame();
  refreshUI();
  renderPlayerInputs();
}

// Render Game Over Screen
function renderGameOver(derived, loser) {
  const loserName = loser || 'A player';
  document.getElementById('eliminationMessage').innerText = `${loserName} has reached ₹0 balance and is eliminated. The session is complete!`;
  document.getElementById('summaryRounds').innerText = state.roundsCount;

  const totalPlayersMoney = Object.values(derived.players).reduce((a, b) => a + b, 0);
  const totalSystemMoney = totalPlayersMoney + derived.bank;
  document.getElementById('summarySystemTotal').innerText = `₹${totalSystemMoney.toLocaleString('en-IN')}`;
  document.getElementById('summaryBankFinal').innerText = `₹${derived.bank.toLocaleString('en-IN')}`;

  // Game Duration
  const durationMs = Date.now() - state.createdAt;
  const durationMins = Math.floor(durationMs / 60000);
  document.getElementById('summaryDuration').innerText = `${durationMins}m`;

  // Final standings sorting (Highest balance first)
  const standings = Object.keys(derived.players).map(name => ({
    name,
    balance: derived.players[name],
    status: derived.players[name] > 0 ? 'Active' : 'Eliminated'
  })).sort((a, b) => b.balance - a.balance);

  const standingsBody = document.getElementById('finalStandingsBody');
  standingsBody.innerHTML = '';
  standings.forEach((player, idx) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>#${idx + 1}</td>
      <td>${player.name}</td>
      <td class="font-highlight">₹${player.balance.toLocaleString('en-IN')}</td>
      <td>
        <span class="player-status-badge ${player.balance > 0 ? 'badge-active' : 'badge-eliminated'}">
          ${player.status}
        </span>
      </td>
    `;
    standingsBody.appendChild(row);
  });
}

// Player to Player Modal handling
function openDirectTransferModal() {
  const senderSelect = document.getElementById('transferSender');
  senderSelect.innerHTML = '';
  
  const derived = deriveBalances();
  state.players.forEach(p => {
    if (derived.players[p] > 0) {
      const opt = document.createElement('option');
      opt.value = p;
      opt.innerText = p;
      senderSelect.appendChild(opt);
    }
  });

  filterTransferReceivers();
  document.getElementById('transferModal').classList.add('active');
}

function closeDirectTransferModal() {
  document.getElementById('transferModal').classList.remove('active');
}

function filterTransferReceivers() {
  const sender = document.getElementById('transferSender').value;
  const receiverSelect = document.getElementById('transferReceiver');
  receiverSelect.innerHTML = '';

  const derived = deriveBalances();
  state.players.forEach(p => {
    if (p !== sender && derived.players[p] > 0) {
      const opt = document.createElement('option');
      opt.value = p;
      opt.innerText = p;
      receiverSelect.appendChild(opt);
    }
  });
}

function submitDirectTransfer() {
  const sender = document.getElementById('transferSender').value;
  const receiver = document.getElementById('transferReceiver').value;
  const amt = parseInt(document.getElementById('transferAmount').value);

  if (!sender || !receiver) return;
  if (isNaN(amt) || amt <= 0) {
    alert("Amount must be greater than zero.");
    return;
  }

  try {
    executeTransaction({
      from: sender,
      to: receiver,
      amount: amt,
      reason: `Direct P2P Transfer`
    });
    closeDirectTransferModal();
    saveGame();
    refreshUI();
  } catch (err) {
    alert(err.message);
  }
}

// Close modals on clicking background
window.onclick = function(event) {
  const modals = document.querySelectorAll('.modal');
  modals.forEach(modal => {
    if (event.target === modal) {
      modal.classList.remove('active');
    }
  });
};
