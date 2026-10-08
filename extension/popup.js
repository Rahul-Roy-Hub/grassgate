const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

let status;

function render() {
  const left = status.unlockUntil - Date.now();
  const open = !status.locked && left > 0;
  $('state').classList.toggle('open', open);
  $('state-icon').textContent = open ? '🔓' : '🔒';
  $('state-title').textContent = open ? 'Open for now' : 'Locked';
  if (open) {
    const s = Math.ceil(left / 1000);
    $('state-sub').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} left, then it locks again`;
  } else {
    $('state-sub').textContent = `${status.sites} site${status.sites === 1 ? '' : 's'} behind the gate`;
  }
  $('lock').hidden = !open;
  $('blocked').textContent = status.blockedToday;
  $('unlocks').textContent = status.unlocksToday;
  $('paired').textContent = status.paired ? '● Paired' : 'Not paired';
  $('pair-hint').hidden = status.paired;
  if (status.locked === false && left <= 0) refresh();
}

async function refresh() {
  status = await send({ type: 'status' });
  render();
}

$('lock').addEventListener('click', async () => { await send({ type: 'lockNow' }); refresh(); });
$('options').addEventListener('click', () => chrome.runtime.openOptionsPage());

await refresh();
setInterval(render, 1000);
