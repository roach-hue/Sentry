import { ChromeConfigStore, DEFAULT_CONFIG } from '~/storage/config-store';
import type { Config } from '~/core/types';

const store = new ChromeConfigStore();
let loadedConfig: Config = DEFAULT_CONFIG;

function setStatus(text: string): void {
  const el = document.getElementById('status');
  if (el) el.textContent = text;
}

function $(id: string): HTMLInputElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as HTMLInputElement;
}

function updateToggleText(): void {
  const on = $('enabled').checked;
  const text = document.querySelector('.toggle-text');
  if (text) {
    text.textContent = on ? '감시 중' : '감시 꺼짐';
    text.className = on ? 'toggle-text on' : 'toggle-text';
  }
  document.getElementById('targetList')?.classList.toggle('disabled', !on);
}

async function load(): Promise<void> {
  const cfg = await store.load();
  loadedConfig = cfg;
  $('enabled').checked = cfg.enabled;
  updateToggleText();
  $('chromeNotification').checked = cfg.channels.chromeNotification;
  $('telegramEnabled').checked = cfg.channels.telegram.enabled;
  $('telegramBotToken').value = cfg.channels.telegram.botToken ?? '';
  $('telegramChatId').value = cfg.channels.telegram.chatId ?? '';
  updateTelegramUI();
  renderTargets();
}

function renderTargets(): void {
  const container = document.getElementById('targetList');
  if (!container) return;
  container.innerHTML = '';

  for (const target of loadedConfig.targets) {
    const card = document.createElement('div');
    card.className = 'target-card';

    const header = document.createElement('div');
    header.className = 'target-header';

    const toggle = document.createElement('label');
    toggle.className = 'target-toggle';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = target.enabled;
    cb.addEventListener('change', async () => {
      target.enabled = cb.checked;
      await saveConfig();
      statusEl.className = target.enabled ? 'target-status on' : 'target-status';
      statusEl.textContent = target.enabled ? 'ON' : 'OFF';
      if ($('enabled').checked && target.enabled) {
        triggerPoll();
      }
    });
    toggle.appendChild(cb);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'target-name';
    nameSpan.textContent = target.name;
    toggle.appendChild(nameSpan);

    const statusEl = document.createElement('span');
    statusEl.className = target.enabled ? 'target-status on' : 'target-status';
    statusEl.textContent = target.enabled ? 'ON' : 'OFF';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-remove';
    removeBtn.textContent = '삭제';
    removeBtn.addEventListener('click', async () => {
      loadedConfig.targets = loadedConfig.targets.filter((t) => t.id !== target.id);
      await chrome.storage.local.remove(`awaodori.watchState.v1.${target.id}`);
      await saveConfig();
      renderTargets();
    });

    header.appendChild(toggle);
    header.appendChild(statusEl);
    header.appendChild(removeBtn);

    const details = document.createElement('div');
    details.className = 'target-details';
    details.textContent = `${target.spec.checkIn} ~ ${target.spec.checkOut} / 성인 ${target.spec.adults} / 객실 ${target.spec.rooms}`;

    card.appendChild(header);
    card.appendChild(details);
    container.appendChild(card);
  }
}

function collect(): Config {
  return {
    ...loadedConfig,
    enabled: $('enabled').checked,
    channels: {
      ...loadedConfig.channels,
      chromeNotification: $('chromeNotification').checked,
      telegram: {
        enabled: $('telegramEnabled').checked,
        botToken: $('telegramBotToken').value.trim() || null,
        chatId: $('telegramChatId').value.trim() || null,
      },
    },
  };
}

async function saveConfig(): Promise<void> {
  loadedConfig = collect();
  await store.save(loadedConfig);
  setStatus('저장 완료.');
}

function triggerPoll(): void {
  setStatus('폴링 중...');
  chrome.runtime.sendMessage({ kind: 'runNow' }, (res) => {
    if (!res) { setStatus('서비스 워커 응답 없음'); return; }
    if (!res.ok) { setStatus(`오류: ${res.error}`); return; }
    const lines = (res.summaries as string[]) ?? [];
    setStatus(lines.join('\n'));
    updateLastPoll();
  });
}

$('enabled').addEventListener('change', async () => {
  updateToggleText();
  await saveConfig();
  if ($('enabled').checked) {
    triggerPoll();
  }
});

function updateTelegramUI(): void {
  const enabled = $('telegramEnabled').checked;
  const hasToken = !!(loadedConfig.channels.telegram.botToken && loadedConfig.channels.telegram.chatId);
  const connectedEl = document.getElementById('telegramConnected');
  const settingsEl = document.getElementById('telegramSettings');
  if (!enabled) {
    connectedEl?.classList.add('hidden');
    settingsEl?.classList.add('hidden');
  } else if (hasToken) {
    connectedEl?.classList.remove('hidden');
    settingsEl?.classList.add('hidden');
  } else {
    connectedEl?.classList.add('hidden');
    settingsEl?.classList.remove('hidden');
  }
}

$('chromeNotification').addEventListener('change', saveConfig);
$('telegramEnabled').addEventListener('change', async () => {
  updateTelegramUI();
  await saveConfig();
});

document.getElementById('telegramEdit')?.addEventListener('click', () => {
  $('telegramBotToken').value = loadedConfig.channels.telegram.botToken ?? '';
  $('telegramChatId').value = loadedConfig.channels.telegram.chatId ?? '';
  document.getElementById('telegramConnected')?.classList.add('hidden');
  document.getElementById('telegramSettings')?.classList.remove('hidden');
});

document.getElementById('telegramSave')?.addEventListener('click', async () => {
  const token = $('telegramBotToken').value.trim();
  const chatId = $('telegramChatId').value.trim();
  if (!token || !chatId) { setStatus('Bot Token과 Chat ID를 모두 입력해 주세요.'); return; }
  await saveConfig();
  updateTelegramUI();
  setStatus('텔레그램 설정 저장됨.');
});

function showAddForm(): void {
  document.getElementById('addForm')?.classList.remove('hidden');
  document.getElementById('showAddForm')?.classList.add('hidden');
}

function hideAddForm(): void {
  document.getElementById('addForm')?.classList.add('hidden');
  document.getElementById('showAddForm')?.classList.remove('hidden');
  $('newName').value = '';
  $('newCheckIn').value = '';
  $('newCheckOut').value = '';
  $('newAdults').value = '2';
  $('newRooms').value = '1';
}

document.getElementById('showAddForm')?.addEventListener('click', showAddForm);
document.getElementById('cancelTarget')?.addEventListener('click', hideAddForm);

document.getElementById('saveTarget')?.addEventListener('click', async () => {
  const name = $('newName').value.trim();
  const checkIn = $('newCheckIn').value;
  const checkOut = $('newCheckOut').value;
  const adults = parseInt($('newAdults').value, 10);
  const rooms = parseInt($('newRooms').value, 10);

  if (!name) { setStatus('이름을 입력해 주세요.'); return; }
  if (!checkIn || !checkOut) { setStatus('체크인/체크아웃 날짜를 입력해 주세요.'); return; }
  if (checkIn >= checkOut) { setStatus('체크아웃이 체크인보다 뒤여야 합니다.'); return; }

  const id = `t-${Date.now()}`;
  loadedConfig.targets.push({
    id,
    name,
    enabled: true,
    spec: { destination: 'Tokushima', checkIn, checkOut, adults: adults || 2, rooms: rooms || 1 },
  });
  await saveConfig();
  renderTargets();
  hideAddForm();
  if ($('enabled').checked) {
    triggerPoll();
  } else {
    setStatus(`${name} 추가됨.`);
  }
});

async function updateLastPoll(): Promise<void> {
  const result = await chrome.storage.local.get('awaodori.lastPoll');
  const el = document.getElementById('lastPollInfo');
  if (!el) return;
  const lastPoll = result['awaodori.lastPoll'] as string | undefined;
  if (!lastPoll) {
    el.textContent = '아직 폴링 기록 없음';
    el.className = 'last-poll warning';
    return;
  }
  const ago = Date.now() - new Date(lastPoll).getTime();
  const hours = Math.floor(ago / 3_600_000);
  const mins = Math.floor((ago % 3_600_000) / 60_000);
  const timeStr = new Date(lastPoll).toLocaleString('ko-KR');

  if (hours >= 24) {
    el.textContent = `⚠️ 마지막 폴링: ${timeStr} (${hours}시간 전 — 감시 중단됨)`;
    el.className = 'last-poll warning';
  } else {
    el.textContent = `마지막 폴링: ${timeStr} (${hours > 0 ? hours + '시간 ' : ''}${mins}분 전)`;
    el.className = 'last-poll';
  }
}

load().catch((e) => setStatus(`초기 로드 실패: ${e instanceof Error ? e.message : String(e)}`));
updateLastPoll();
