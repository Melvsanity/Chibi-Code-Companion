import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

type PetState = 'idle' | 'eating' | 'sleeping' | 'happy' | 'blinking';

interface Personality {
  name:     string;
  idle:     string[];
  eating:   string[];
  sleeping: string[];
  happy:    string[];
}

interface CharacterAssets {
  idle:     string | null;
  eating:   string | null;
  sleeping: string | null;
  happy:    string | null;
  blinking: string | null;
}

const INACTIVITY_MS  = 60_000;
const EATING_MS      = 4_000;
const HAPPY_MS       = 3_000;
const DEBOUNCE_MS    = 150;
const CHATTER_MIN_MS = 12_000;
const CHATTER_MAX_MS = 18_000;

const DEFAULT_PERSONALITY: Personality = {
  name:     'Unknown',
  idle:     ['( ^-^ )', 'Watching you code~', 'Keep going!', 'uwu'],
  eating:   ['Yummy!', 'Om nom nom~'],
  sleeping: ['Zzz...', 'Nap time~'],
  happy:    ['Yay!!', 'You clicked me!'],
};

const ERROR_PERSONALITY: Personality = {
  name:     '???',
  idle:     [
    'No images found!',
    'Add images to media/yourcharacter/',
    'ERROR: Character not found',
    'Did you forget to add images?',
    'Please add a character!',
  ],
  eating:   ["I can't eat without a character!", 'No images... no ramen?'],
  sleeping: ['Zzz... still no images...', 'Sleeping until you add images'],
  happy:    ['At least you clicked me!', 'Add images please! uwu'],
};

// ─── State ────────────────────────────────────────────────────────────────────

let currentState: PetState = 'idle';
let inactivityTimer:  ReturnType<typeof setTimeout> | undefined;
let debounceTimer:    ReturnType<typeof setTimeout> | undefined;
let eatingTimer:      ReturnType<typeof setTimeout> | undefined;
let happyTimer:       ReturnType<typeof setTimeout> | undefined;
let provider:         ChibiPetViewProvider | undefined;

// ─── Caches ───────────────────────────────────────────────────────────────────

let characterCache:    CharacterInfo[] | null = null;
let personalityCache:  Map<string, Personality> = new Map();
let assetCache:        Map<string, CharacterAssets> = new Map();
let errorImageCache:   string | null | undefined = undefined;

function clearCaches() {
  characterCache   = null;
  personalityCache.clear();
  assetCache.clear();
  errorImageCache  = undefined;
}

// ─── Activate ─────────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
  provider = new ChibiPetViewProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('chibiCompanion.petView', provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('chibiCompanion.switchCharacter', async () => {
      const characters = getCharacterList(context);
      if (characters.length === 0) {
        vscode.window.showInformationMessage('No character folders found in media/.');
        return;
      }
      const current = context.globalState.get<string>('activeCharacter', '');
      const items = characters.map(c => ({
        label:       c.folderName,
        description: c.displayName !== c.folderName ? c.displayName : '',
        detail:      c.folderName === current ? 'active' : '',
      }));
      const pick = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a character',
        title:       'Chibi Code Companion: Switch Character',
      });
      if (!pick) { return; }
      await switchToCharacter(context, pick.label);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('chibiCompanion.show', () => {
      vscode.commands.executeCommand('chibiCompanion.petView.focus');
    }),
  );

  // ── VS Code event listeners ──────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => {
      handleActivity();
      if (currentState === 'eating') { return; }
      clearTimeout(eatingTimer);
      setState('eating');
      eatingTimer = setTimeout(() => setState('idle'), EATING_MS);
    }),

    vscode.workspace.onDidChangeTextDocument(() => handleActivityDebounced()),
    vscode.window.onDidChangeActiveTextEditor(() => handleActivityDebounced()),
    vscode.window.onDidChangeTextEditorSelection(() => handleActivityDebounced()),

    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('chibiCompanion')) {
        clearCaches();
        provider?.rebuild();
      }
    }),
  );

  startInactivityTimer();
}

export function deactivate() {
  clearTimeout(inactivityTimer);
  clearTimeout(debounceTimer);
  clearTimeout(eatingTimer);
  clearTimeout(happyTimer);
}

// ─── Activity helpers ─────────────────────────────────────────────────────────

function handleActivity() {
  resetInactivity();
  if (currentState === 'sleeping') { setState('idle'); }
}

function handleActivityDebounced() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(handleActivity, DEBOUNCE_MS);
}

// ─── Character helpers ────────────────────────────────────────────────────────

interface CharacterInfo {
  folderName:  string;
  displayName: string;
}

function getCharacterList(context: vscode.ExtensionContext): CharacterInfo[] {
  if (characterCache) { return characterCache; }
  const mediaDir = path.join(context.extensionUri.fsPath, 'media');
  try {
    characterCache = fs.readdirSync(mediaDir)
      .filter(f => fs.statSync(path.join(mediaDir, f)).isDirectory())
      .map(folderName => {
        const personality = loadPersonality(context, folderName);
        return { folderName, displayName: personality.name };
      });
  } catch {
    characterCache = [];
  }
  return characterCache;
}

function loadPersonality(context: vscode.ExtensionContext, folderName: string): Personality {
  if (personalityCache.has(folderName)) {
    return personalityCache.get(folderName)!;
  }
  let result: Personality;
  try {
    const pFile = path.join(context.extensionUri.fsPath, 'media', folderName, 'personality.json');
    if (fs.existsSync(pFile)) {
      const raw    = fs.readFileSync(pFile, 'utf8');
      const parsed = JSON.parse(raw) as Partial<Personality>;
      result = {
        name:     parsed.name     || folderName,
        idle:     parsed.idle     || DEFAULT_PERSONALITY.idle,
        eating:   parsed.eating   || DEFAULT_PERSONALITY.eating,
        sleeping: parsed.sleeping || DEFAULT_PERSONALITY.sleeping,
        happy:    parsed.happy    || DEFAULT_PERSONALITY.happy,
      };
    } else {
      result = { ...DEFAULT_PERSONALITY, name: folderName };
    }
  } catch {
    result = { ...DEFAULT_PERSONALITY, name: folderName };
  }
  personalityCache.set(folderName, result);
  return result;
}

function resolveCharacterAssets(
  context: vscode.ExtensionContext,
  webview: vscode.Webview,
  folderName: string,
): CharacterAssets {
  const cacheKey = folderName;
  if (assetCache.has(cacheKey)) { return assetCache.get(cacheKey)!; }

  const states: PetState[] = ['idle', 'eating', 'sleeping', 'happy', 'blinking'];
  const exts = ['.gif', '.png', '.svg', '.jpg', '.jpeg', '.webp'];
  const result = {} as CharacterAssets;

  for (const state of states) {
    let found: string | null = null;
    for (const ext of exts) {
      const filePath = path.join(context.extensionUri.fsPath, 'media', folderName, state + ext);
      if (fs.existsSync(filePath)) {
        const uri = vscode.Uri.joinPath(context.extensionUri, 'media', folderName, state + ext);
        found = webview.asWebviewUri(uri).toString();
        break;
      }
    }
    result[state] = found;
  }

  assetCache.set(cacheKey, result);
  return result;
}

function resolveLegacyAssets(context: vscode.ExtensionContext, webview: vscode.Webview): CharacterAssets {
  const c = vscode.workspace.getConfiguration('chibiCompanion');
  const resolve = (filename: string): string | null => {
    if (!filename) { return null; }
    const p = vscode.Uri.joinPath(context.extensionUri, 'media', filename);
    if (!fs.existsSync(p.fsPath)) { return null; }
    return webview.asWebviewUri(p).toString();
  };
  return {
    idle:     resolve(c.get<string>('assets.idle',     '')),
    eating:   resolve(c.get<string>('assets.eating',   '')),
    sleeping: resolve(c.get<string>('assets.sleeping', '')),
    happy:    resolve(c.get<string>('assets.happy',    '')),
    blinking: resolve(c.get<string>('assets.blinking', '')),
  };
}

function resolveErrorImage(context: vscode.ExtensionContext, webview: vscode.Webview): string | null {
  if (errorImageCache !== undefined) { return errorImageCache; }
  const exts = ['.png', '.gif', '.jpg', '.jpeg', '.svg', '.webp'];
  for (const ext of exts) {
    const p = vscode.Uri.joinPath(context.extensionUri, 'media', 'error' + ext);
    if (fs.existsSync(p.fsPath)) {
      errorImageCache = webview.asWebviewUri(p).toString();
      return errorImageCache;
    }
  }
  errorImageCache = null;
  return null;
}

async function switchToCharacter(context: vscode.ExtensionContext, folderName: string) {
  await context.globalState.update('activeCharacter', folderName);
  await vscode.workspace.getConfiguration('chibiCompanion').update(
    'activeCharacter', folderName, vscode.ConfigurationTarget.Global,
  );
  currentState = 'idle';
  personalityCache.clear();
  assetCache.clear();
  provider?.rebuild();
  const personality = loadPersonality(context, folderName);
  vscode.window.showInformationMessage('Chibi Code Companion: Switched to ' + personality.name + '!');
}

// ─── State helpers ────────────────────────────────────────────────────────────

function setState(next: PetState) {
  if (currentState === next) { return; }
  currentState = next;
  provider?.postState(next);
}

function resetInactivity() {
  clearTimeout(inactivityTimer);
  startInactivityTimer();
}

function startInactivityTimer() {
  inactivityTimer = setTimeout(() => {
    if (currentState === 'idle') { setState('sleeping'); }
  }, INACTIVITY_MS);
}

// ─── Provider ─────────────────────────────────────────────────────────────────

class ChibiPetViewProvider implements vscode.WebviewViewProvider {
  private view?:     vscode.WebviewView;
  private builtHtml: string | null = null;

  constructor(private readonly ctx: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, 'media')],
    };

    this.builtHtml = this.buildHtml(webviewView.webview);
    webviewView.webview.html = this.builtHtml;

    webviewView.webview.onDidReceiveMessage(msg => {
      if (msg.type === 'petClick') {
        setState('happy');
        clearTimeout(happyTimer);
        happyTimer = setTimeout(() => setState('idle'), HAPPY_MS);
      }
      if (msg.type === 'ready')           { this.postState(currentState); }
      if (msg.type === 'switchCharacter') { switchToCharacter(this.ctx, msg.character as string); }
    });
  }

  postState(state: PetState) {
    this.view?.webview.postMessage({ type: 'setState', state });
  }

  rebuild() {
    this.builtHtml = null;
    if (this.view) {
      this.builtHtml = this.buildHtml(this.view.webview);
      this.view.webview.html = this.builtHtml;
      setTimeout(() => this.postState(currentState), 150);
    }
  }

  refresh() { this.rebuild(); }

  private buildHtml(webview: vscode.Webview): string {
    const cfg        = vscode.workspace.getConfiguration('chibiCompanion');
    const activeChar = cfg.get<string>('activeCharacter', '')
      || this.ctx.globalState.get<string>('activeCharacter', '');
    const characters = getCharacterList(this.ctx);

    let assets:      CharacterAssets;
    let personality: Personality;

    if (activeChar && characters.some(c => c.folderName === activeChar)) {
      assets      = resolveCharacterAssets(this.ctx, webview, activeChar);
      personality = loadPersonality(this.ctx, activeChar);
    } else if (characters.length > 0) {
      const first = characters[0];
      assets      = resolveCharacterAssets(this.ctx, webview, first.folderName);
      personality = loadPersonality(this.ctx, first.folderName);
    } else {
      assets      = resolveLegacyAssets(this.ctx, webview);
      personality = DEFAULT_PERSONALITY;
    }

    const isAnimated = assets.idle?.toLowerCase().includes('.gif') ?? false;
    const shadowJson = JSON.stringify(!isAnimated);

    const hasAsset          = Object.values(assets).some(Boolean);
    const errorImgUri       = resolveErrorImage(this.ctx, webview);
    const activePersonality = hasAsset ? personality : ERROR_PERSONALITY;

    const blinkEnabled = cfg.get<boolean>('blink.enabled', true);
    const blinkMin     = cfg.get<number>('blink.minDelay', 2000);
    const blinkMax     = cfg.get<number>('blink.maxDelay', 6000);

    const assetJson       = JSON.stringify(assets);
    const hasJson         = JSON.stringify(hasAsset);
    const personalityJson = JSON.stringify(activePersonality);
    const activeCharJson  = JSON.stringify(activeChar || (characters[0]?.folderName ?? ''));
    const charactersJson  = JSON.stringify(characters.map(c => ({ folder: c.folderName, name: c.displayName })));
    const blinkJson       = JSON.stringify({ enabled: blinkEnabled, min: blinkMin, max: blinkMax });
    const errorImgJson    = JSON.stringify(errorImgUri);

    return [
      '<!DOCTYPE html>',
      '<html lang="en"><head>',
      '<meta charset="UTF-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      '<style>' + this.css() + '</style>',
      '</head><body>',
      this.body(),
      '<script>',
      this.script(assetJson, hasJson, personalityJson, activeCharJson, charactersJson, blinkJson, errorImgJson, shadowJson),
      '<\/script>',
      '</body></html>',
    ].join('\n');
  }

  private css(): string {
    return `
* { margin:0; padding:0; box-sizing:border-box; }
body {
  background: var(--vscode-sideBar-background, #1e1e2e);
  color: var(--vscode-foreground, #cdd6f4);
  font-family: var(--vscode-font-family, sans-serif);
  height: 100vh; display: flex; flex-direction: column;
  align-items: center; justify-content: flex-end;
  overflow: hidden; user-select: none; padding-bottom: 16px;
}
body::before {
  content: ''; position: fixed; inset: 0; pointer-events: none;
  background-image:
    radial-gradient(1px 1px at 15% 25%, rgba(255,255,255,0.12) 0%, transparent 100%),
    radial-gradient(1px 1px at 40% 60%, rgba(255,255,255,0.08) 0%, transparent 100%),
    radial-gradient(1px 1px at 70% 20%, rgba(255,255,255,0.10) 0%, transparent 100%),
    radial-gradient(1px 1px at 85% 75%, rgba(255,255,255,0.06) 0%, transparent 100%),
    radial-gradient(1px 1px at 25% 80%, rgba(255,255,255,0.08) 0%, transparent 100%);
}
.desk {
  position: fixed; bottom: 0; left: 0; right: 0; height: 48px;
  background: var(--vscode-sideBarSectionHeader-background, #2a2a3e);
  border-top: 1px solid var(--vscode-sideBarSectionHeader-border, #3a3a5c); z-index: 1;
}
.char-bar {
  position: fixed; top: 0; left: 0; right: 0;
  display: flex; align-items: center; gap: 4px; flex-wrap: wrap; padding: 5px 8px;
  background: var(--vscode-sideBarSectionHeader-background, #2a2a3e);
  border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, #3a3a5c); z-index: 20;
}
.char-btn {
  padding: 2px 10px; border-radius: 10px; font-size: 11px; font-weight: 600;
  cursor: pointer; border: 1px solid transparent;
  color: var(--vscode-foreground); opacity: 0.45;
  background: transparent; transition: all 0.15s; white-space: nowrap;
}
.char-btn:hover { opacity: 0.8; background: rgba(255,255,255,0.07); }
.char-btn.active {
  opacity: 1; background: var(--vscode-button-background, #4c4c8a);
  color: var(--vscode-button-foreground, #fff); border-color: transparent;
}
.no-chars { font-size: 10px; opacity: 0.35; padding: 3px 6px; }
.pet-wrap {
  position: relative; z-index: 10;
  display: flex; flex-direction: column; align-items: center;
  cursor: pointer; margin-bottom: 52px; margin-top: 48px;
}
.bubble {
  background: var(--vscode-input-background, #fff);
  color: var(--vscode-input-foreground, #333);
  border: 1px solid var(--vscode-input-border, #ccc);
  font-size: 11px; font-weight: 700; padding: 5px 10px; border-radius: 12px; margin-bottom: 8px;
  position: relative; opacity: 0; transform: translateY(4px) scale(0.9);
  transition: all 0.3s cubic-bezier(0.34,1.56,0.64,1);
  white-space: normal; max-width: 150px; text-align: center;
  pointer-events: none; box-shadow: 0 2px 8px rgba(0,0,0,0.3);
}
.bubble::after {
  content: ''; position: absolute; bottom: -6px; left: 50%; transform: translateX(-50%);
  border: 6px solid transparent; border-top-color: var(--vscode-input-background, #fff); border-bottom: none;
}
.bubble.show { opacity: 1; transform: translateY(0) scale(1); }
.pet {
  width: 150px; height: 150px; position: relative;
  animation: idle-bounce 2.4s ease-in-out infinite;
  display: flex; align-items: center; justify-content: center;
}
.pet-img { width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; display: none; }
.zzz {
  position: absolute; top: -24px; right: -8px; font-size: 13px; font-weight: 800;
  color: #a0b4ff; opacity: 0; display: flex; flex-direction: column;
  align-items: flex-end; pointer-events: none;
}
.zzz span { opacity: 0; display: block; animation: zzz-float 3s ease-in-out infinite; }
.zzz span:nth-child(1){ font-size: 8px;  animation-delay: 0s; }
.zzz span:nth-child(2){ font-size: 10px; animation-delay: 0.5s; }
.zzz span:nth-child(3){ font-size: 13px; animation-delay: 1s; }
.state-sleeping .zzz { opacity: 1; }
.hearts { position: absolute; top: -12px; left: 50%; transform: translateX(-50%); pointer-events: none; }
.heart { position: absolute; font-size: 15px; opacity: 0; }
.state-happy .heart { animation: heart-pop 1s ease-out forwards; }
.state-happy .heart:nth-child(1){ left: -22px; animation-delay: 0s; }
.state-happy .heart:nth-child(2){ left: 0px;   animation-delay: 0.15s; }
.state-happy .heart:nth-child(3){ left: 22px;  animation-delay: 0.3s; }
.sleep-tint {
  position: absolute; inset: 0; background: rgba(80,100,200,0.18);
  border-radius: 8px; opacity: 0; transition: opacity 0.5s; pointer-events: none;
}
.state-sleeping .sleep-tint { opacity: 1; }
.state-badge { font-size: 9px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.4; margin-bottom: 4px; color: var(--vscode-foreground); }
.name-tag { font-size: 11px; font-weight: 700; opacity: 0.5; margin-top: 6px; color: var(--vscode-foreground); }
.hint { font-size: 9px; opacity: 0.25; margin-top: 2px; color: var(--vscode-foreground); }
@keyframes idle-bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
@keyframes zzz-float   { 0%{opacity:0;transform:translate(0,0) scale(0.8)} 30%{opacity:1} 100%{opacity:0;transform:translate(4px,-18px) scale(1.2)} }
@keyframes heart-pop   { 0%{opacity:0;transform:translateY(0) scale(0.5)} 40%{opacity:1;transform:translateY(-14px) scale(1.2)} 100%{opacity:0;transform:translateY(-30px) scale(0.8)} }
`;
  }

  private body(): string {
    return `
<div class="char-bar" id="char-bar"></div>
<div class="desk"></div>
<div class="pet-wrap" onclick="onPetClick()">
  <div class="state-badge" id="state-badge">Idle</div>
  <div class="bubble" id="bubble">Hiii!</div>
  <div class="pet" id="pet">
    <div class="hearts">
      <span class="heart">&#x1F495;</span>
      <span class="heart">&#x1F496;</span>
      <span class="heart">&#x1F495;</span>
    </div>
    <div class="zzz"><span>z</span><span>z</span><span>Z</span></div>
    <div class="sleep-tint"></div>
    <img id="pet-img" class="pet-img" alt="pet" />
  </div>
  <div class="name-tag" id="name-tag">???</div>
  <div class="hint">click to cheer up!</div>
</div>
`;
  }

  private script(
    assetJson: string, hasJson: string, personalityJson: string,
    activeCharJson: string, charactersJson: string, blinkJson: string,
    errorImgJson: string, shadowJson: string,
  ): string {
    return `
var vscode      = acquireVsCodeApi();
var ASSETS      = ${assetJson};
var HAS         = ${hasJson};
var PERSONALITY = ${personalityJson};
var ACTIVE_CHAR = ${activeCharJson};
var CHARACTERS  = ${charactersJson};
var BLINK_CFG   = ${blinkJson};
var ERROR_IMG   = ${errorImgJson};

var pet     = document.getElementById('pet');
var petImg  = document.getElementById('pet-img');
var bubble  = document.getElementById('bubble');
var badge   = document.getElementById('state-badge');
var nameTag = document.getElementById('name-tag');
var charBar = document.getElementById('char-bar');

var currentState     = 'idle';
var bubbleTimer      = null;
var blinkTimer       = null;
var blinkReturnTimer = null;
var chatterTimer     = null;   // now a setTimeout handle, not setInterval
var mode = HAS ? 'image' : 'error';

// ── Build character switcher ──────────────────────────────────────────────────
function buildCharBar() {
  if (CHARACTERS.length <= 1) {
    charBar.style.display = 'none';
    var petWrap = document.querySelector('.pet-wrap');
    if (petWrap) { petWrap.style.marginTop = '8px'; }
    return;
  }
  charBar.style.display = 'flex';
  var frag = document.createDocumentFragment();
  CHARACTERS.forEach(function(ch) {
    var btn = document.createElement('button');
    btn.className = 'char-btn' + (ch.folder === ACTIVE_CHAR ? ' active' : '');
    btn.textContent = ch.name;
    btn.title = ch.folder;
    btn.onclick = function(e) {
      e.stopPropagation();
      vscode.postMessage({ type: 'switchCharacter', character: ch.folder });
    };
    frag.appendChild(btn);
  });
  charBar.appendChild(frag);
}

// ── Blink system ──────────────────────────────────────────────────────────────
function scheduleBlink() {
  if (!BLINK_CFG.enabled || mode !== 'image') { return; }
  clearTimeout(blinkTimer);
  var delay = BLINK_CFG.min + Math.random() * (BLINK_CFG.max - BLINK_CFG.min);
  blinkTimer = setTimeout(function() {
    if (currentState === 'idle') { doBlink(); }
    else { scheduleBlink(); }
  }, delay);
}

function doBlink() {
  setStateInternal('blinking', false);
  var holdTime = Math.random() < 0.6 ? 120 : 230;
  blinkReturnTimer = setTimeout(function() {
    setStateInternal('idle', false);
    scheduleBlink();
  }, holdTime);
}

function stopBlink() {
  clearTimeout(blinkTimer);
  clearTimeout(blinkReturnTimer);
}

// ── Idle chatter — randomized interval, always fires ─────────────────────────
// Old approach: fixed 12s setInterval + 30% gate = ~40s average wait
// New approach: random 9–15s setTimeout, fires every time when idle
function scheduleChatter() {
  clearTimeout(chatterTimer);
  var delay = ${CHATTER_MIN_MS} + Math.random() * (${CHATTER_MAX_MS} - ${CHATTER_MIN_MS});
  chatterTimer = setTimeout(function() {
    if (currentState === 'idle') {
      showBubbleText(pick('idle'));
    }
    scheduleChatter(); // always reschedule, even if she was busy
  }, delay);
}

// ── Setup ─────────────────────────────────────────────────────────────────────
var USE_SHADOW = ${shadowJson};

function setup() {
  if (USE_SHADOW) {
    pet.style.filter = 'drop-shadow(0 6px 16px rgba(180,100,220,0.25))';
  } else {
    pet.style.filter = 'none';
  }

  nameTag.textContent = PERSONALITY.name;
  buildCharBar();
  petImg.style.display = 'block';

  if (mode === 'image') {
    setImage('idle');
    scheduleBlink();
  } else if (ERROR_IMG) {
    petImg.src = ERROR_IMG;
  }

  scheduleChatter(); // ← was startChatter()
}

function setImage(state) {
  if (mode !== 'image') { return; }
  var src = ASSETS[state] || ASSETS['idle'];
  if (!src || petImg.src === src) { return; }
  petImg.src = src;
}

// ── State machine ─────────────────────────────────────────────────────────────
function setStateInternal(state, showBubble) {
  currentState = state;
  pet.className = 'pet state-' + state;
  var displayName = state === 'blinking' ? 'idle' : state;
  badge.textContent = displayName.charAt(0).toUpperCase() + displayName.slice(1);

  if (mode === 'image') {
    if (state !== 'blinking') { stopBlink(); }
    setImage(state);
    if (state === 'idle') { scheduleBlink(); }
  }

  if (showBubble) { showBubbleText(pick(state)); }
}

function setState(state) {
  setStateInternal(state, true);
}

// ── Dialogue ──────────────────────────────────────────────────────────────────
function pick(state) {
  var lines = PERSONALITY[state];
  if (!lines || lines.length === 0) { lines = PERSONALITY.idle; }
  return lines[Math.floor(Math.random() * lines.length)];
}

function showBubbleText(text) {
  clearTimeout(bubbleTimer);
  bubble.textContent = text;
  bubble.classList.add('show');
  bubbleTimer = setTimeout(function() { bubble.classList.remove('show'); }, 3500);
}

function onPetClick() { vscode.postMessage({ type: 'petClick' }); }

window.addEventListener('message', function(e) {
  if (e.data.type === 'setState') { setState(e.data.state); }
});

setup();
vscode.postMessage({ type: 'ready' });
setTimeout(function() { showBubbleText(pick('idle')); }, 600);
`;
  }
}