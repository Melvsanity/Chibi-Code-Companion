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

const INACTIVITY_MS = 60_000;
const EATING_MS     = 4_000;
const HAPPY_MS      = 3_000;

const DEFAULT_PERSONALITY: Personality = {
  name:     'Mochi',
  idle:     ['( ^-^ )', 'Watching you code~', 'Meow!', 'uwu', 'Keep going!'],
  eating:   ['Slurp! Ramen!', 'Yummy!', 'Om nom nom~'],
  sleeping: ['Zzz...', 'Nap time~', '...zz'],
  happy:    ['Yay!! ^_^', 'I love you!', 'You clicked me!'],
};

let currentState: PetState = 'idle';
let inactivityTimer: ReturnType<typeof setTimeout> | undefined;
let provider: ChibiPetViewProvider | undefined;

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
        label: c.folderName,
        description: c.displayName !== c.folderName ? c.displayName : '',
        detail: c.folderName === current ? 'active' : '',
      }));
      const pick = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a character',
        title: 'Chibi Pet Switch Character',
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

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => {
      resetInactivity();
      setState('eating');
      setTimeout(() => setState('idle'), EATING_MS);
    }),
    vscode.workspace.onDidChangeTextDocument(() => {
      resetInactivity();
      if (currentState === 'sleeping') { setState('idle'); }
    }),
    vscode.window.onDidChangeActiveTextEditor(() => {
      resetInactivity();
      if (currentState === 'sleeping') { setState('idle'); }
    }),
    vscode.window.onDidChangeTextEditorSelection(() => {
      resetInactivity();
      if (currentState === 'sleeping') { setState('idle'); }
    }),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('chibiPet')) { provider?.refresh(); }
    }),
  );

  startInactivityTimer();
}

export function deactivate() {
  clearTimeout(inactivityTimer);
}

interface CharacterInfo {
  folderName:  string;
  displayName: string;
}

function getCharacterList(context: vscode.ExtensionContext): CharacterInfo[] {
  const mediaDir = path.join(context.extensionUri.fsPath, 'media');
  try {
    return fs.readdirSync(mediaDir)
      .filter(f => fs.statSync(path.join(mediaDir, f)).isDirectory())
      .map(folderName => {
        const personality = loadPersonality(context, folderName);
        return { folderName, displayName: personality.name };
      });
  } catch {
    return [];
  }
}

function loadPersonality(context: vscode.ExtensionContext, folderName: string): Personality {
  try {
    const pFile = path.join(context.extensionUri.fsPath, 'media', folderName, 'personality.json');
    if (fs.existsSync(pFile)) {
      const raw    = fs.readFileSync(pFile, 'utf8');
      const parsed = JSON.parse(raw) as Partial<Personality>;
      return {
        name:     parsed.name     || folderName,
        idle:     parsed.idle     || DEFAULT_PERSONALITY.idle,
        eating:   parsed.eating   || DEFAULT_PERSONALITY.eating,
        sleeping: parsed.sleeping || DEFAULT_PERSONALITY.sleeping,
        happy:    parsed.happy    || DEFAULT_PERSONALITY.happy,
      };
    }
  } catch { /* fall through */ }
  return { ...DEFAULT_PERSONALITY, name: folderName };
}

function resolveCharacterAssets(
  context: vscode.ExtensionContext,
  webview: vscode.Webview,
  folderName: string,
): CharacterAssets {
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
  return result;
}

function resolveLegacyAssets(context: vscode.ExtensionContext, webview: vscode.Webview): CharacterAssets {
  const c = vscode.workspace.getConfiguration('chibiPet');
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

async function switchToCharacter(context: vscode.ExtensionContext, folderName: string) {
  await context.globalState.update('activeCharacter', folderName);
  await vscode.workspace.getConfiguration('chibiPet').update(
    'activeCharacter', folderName, vscode.ConfigurationTarget.Global,
  );
  currentState = 'idle';
  provider?.refresh();
  const personality = loadPersonality(context, folderName);
  vscode.window.showInformationMessage('Chibi Pet: Switched to ' + personality.name + '!');
}

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

class ChibiPetViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  constructor(private readonly ctx: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.ctx.extensionUri, 'media')],
    };
    webviewView.webview.html = this.buildHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(msg => {
      if (msg.type === 'petClick') {
        setState('happy');
        setTimeout(() => setState('idle'), HAPPY_MS);
      }
      if (msg.type === 'ready')           { this.postState(currentState); }
      if (msg.type === 'switchCharacter') { switchToCharacter(this.ctx, msg.character as string); }
    });
  }

  postState(state: PetState) {
    this.view?.webview.postMessage({ type: 'setState', state });
  }

  refresh() {
    if (this.view) {
      this.view.webview.html = this.buildHtml(this.view.webview);
      setTimeout(() => this.postState(currentState), 150);
    }
  }

  private buildHtml(webview: vscode.Webview): string {
    const cfg        = vscode.workspace.getConfiguration('chibiPet');
    const activeChar = cfg.get<string>('activeCharacter', '') || this.ctx.globalState.get<string>('activeCharacter', '');
    const characters = getCharacterList(this.ctx);

    let assets: CharacterAssets;
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

    const hasAsset     = Object.values(assets).some(Boolean);
    const blinkEnabled = cfg.get<boolean>('blink.enabled', true);
    const blinkMin     = cfg.get<number>('blink.minDelay', 2000);
    const blinkMax     = cfg.get<number>('blink.maxDelay', 6000);

    const assetJson       = JSON.stringify(assets);
    const hasJson         = JSON.stringify(hasAsset);
    const personalityJson = JSON.stringify(personality);
    const activeCharJson  = JSON.stringify(activeChar || (characters[0]?.folderName ?? ''));
    const charactersJson  = JSON.stringify(characters.map(c => ({ folder: c.folderName, name: c.displayName })));
    const blinkJson       = JSON.stringify({ enabled: blinkEnabled, min: blinkMin, max: blinkMax });

    return [
      '<!DOCTYPE html>',
      '<html lang="en"><head>',
      '<meta charset="UTF-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      '<style>' + this.css() + '</style>',
      '</head><body>',
      this.body(),
      '<script>',
      this.script(assetJson, hasJson, personalityJson, activeCharJson, charactersJson, blinkJson),
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
  filter: drop-shadow(0 6px 16px rgba(180,100,220,0.25));
  display: flex; align-items: center; justify-content: center;
}
.pet-img { width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; display: none; }
.css-pet { width: 100%; height: 100%; position: relative; }
.cat-body {
  position: absolute; bottom: 0; left: 50%; transform: translateX(-50%);
  width: 62%; height: 52%; background: linear-gradient(135deg, #ffb8c8, #ff8faa); border-radius: 50% 50% 40% 40%;
}
.cat-tummy {
  position: absolute; bottom: 4px; left: 50%; transform: translateX(-50%);
  width: 52%; height: 58%; background: #fff0f3; border-radius: 50%;
}
.cat-head {
  position: absolute; top: 0; left: 50%; transform: translateX(-50%);
  width: 66%; height: 58%; background: linear-gradient(135deg, #ffb8c8, #ff8faa); border-radius: 50% 50% 45% 45%;
}
.cat-ear-l,.cat-ear-r {
  position: absolute; top: -12px; width: 0; height: 0;
  border-left: 11px solid transparent; border-right: 11px solid transparent; border-bottom: 22px solid #ff8faa;
}
.cat-ear-l { left: 4px; transform: rotate(-15deg); }
.cat-ear-r { right: 4px; transform: rotate(15deg); }
.cat-ear-l::after,.cat-ear-r::after {
  content: ''; position: absolute; top: 5px; left: -6px; width: 0; height: 0;
  border-left: 6px solid transparent; border-right: 6px solid transparent; border-bottom: 13px solid #ffccd8;
}
.cat-eyes { position: absolute; top: 30%; left: 50%; transform: translateX(-50%); display: flex; gap: 16px; }
.eye { width: 11px; height: 11px; background: #2c1a2e; border-radius: 50%; position: relative; transition: all 0.3s; }
.eye::after { content: ''; position: absolute; top: 1px; right: 1px; width: 3px; height: 3px; background: white; border-radius: 50%; }
.state-sleeping .eye { height: 2px; border-radius: 2px; margin-top: 5px; }
.state-sleeping .eye::after { display: none; }
.cat-blush-l,.cat-blush-r { position: absolute; top: 47%; width: 13px; height: 8px; background: rgba(255,100,120,0.4); border-radius: 50%; }
.cat-blush-l { left: 5px; } .cat-blush-r { right: 5px; }
.cat-nose { position: absolute; top: 55%; left: 50%; transform: translateX(-50%); width: 6px; height: 5px; background: #e05070; border-radius: 50%; }
.cat-mouth {
  position: absolute; top: 64%; left: 50%; transform: translateX(-50%);
  width: 13px; height: 6px; border-bottom: 2px solid #e05070; border-left: 2px solid #e05070;
  border-right: 2px solid #e05070; border-radius: 0 0 8px 8px; transition: all 0.2s;
}
.cat-tail {
  position: absolute; bottom: 10%; right: -22%; width: 26%; height: 13%;
  background: #ff8faa; border-radius: 10px; transform-origin: left center; animation: tail-wag 2s ease-in-out infinite;
}
.state-sleeping .cat-tail { animation: none; transform: rotate(15deg); }
.cat-paw-l,.cat-paw-r { position: absolute; bottom: -8%; width: 21%; height: 13%; background: #ffb8c8; border-radius: 50%; }
.cat-paw-l { left: 8%; } .cat-paw-r { right: 8%; }
.ramen-bowl { position: absolute; bottom: -8px; left: 50%; transform: translateX(-50%); font-size: 28px; opacity: 0; transition: opacity 0.3s; pointer-events: none; }
.state-eating .ramen-bowl { opacity: 1; }
.zzz { position: absolute; top: -24px; right: -8px; font-size: 13px; font-weight: 800; color: #a0b4ff; opacity: 0; display: flex; flex-direction: column; align-items: flex-end; pointer-events: none; }
.zzz span { opacity: 0; display: block; animation: zzz-float 3s ease-in-out infinite; }
.zzz span:nth-child(1){ font-size: 8px; animation-delay: 0s; }
.zzz span:nth-child(2){ font-size: 10px; animation-delay: 0.5s; }
.zzz span:nth-child(3){ font-size: 13px; animation-delay: 1s; }
.state-sleeping .zzz { opacity: 1; }
.hearts { position: absolute; top: -12px; left: 50%; transform: translateX(-50%); pointer-events: none; }
.heart { position: absolute; font-size: 15px; opacity: 0; }
.state-happy .heart { animation: heart-pop 1s ease-out forwards; }
.state-happy .heart:nth-child(1){ left: -22px; animation-delay: 0s; }
.state-happy .heart:nth-child(2){ left: 0px;   animation-delay: 0.15s; }
.state-happy .heart:nth-child(3){ left: 22px;  animation-delay: 0.3s; }
.steam { position: absolute; bottom: 18px; left: 50%; transform: translateX(-50%); display: flex; gap: 6px; pointer-events: none; }
.steam-line { width: 3px; height: 0; background: rgba(255,255,255,0.5); border-radius: 2px; opacity: 0; }
.state-eating .steam-line { animation: steam-rise 1s ease-out infinite; }
.state-eating .steam-line:nth-child(1){ animation-delay: 0s; }
.state-eating .steam-line:nth-child(2){ animation-delay: 0.3s; }
.state-eating .steam-line:nth-child(3){ animation-delay: 0.6s; }
.state-eating .cat-head { animation: eating-bob 0.5s ease-in-out infinite; }
.sleep-tint { position: absolute; inset: 0; background: rgba(80,100,200,0.18); border-radius: 8px; opacity: 0; transition: opacity 0.5s; pointer-events: none; }
.state-sleeping .sleep-tint { opacity: 1; }
.state-badge { font-size: 9px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.4; margin-bottom: 4px; color: var(--vscode-foreground); }
.name-tag { font-size: 11px; font-weight: 700; opacity: 0.5; margin-top: 6px; color: var(--vscode-foreground); }
.hint { font-size: 9px; opacity: 0.25; margin-top: 2px; color: var(--vscode-foreground); }
@keyframes idle-bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
@keyframes tail-wag    { 0%,100%{transform:rotate(-10deg)} 50%{transform:rotate(22deg)} }
@keyframes zzz-float   { 0%{opacity:0;transform:translate(0,0) scale(0.8)} 30%{opacity:1} 100%{opacity:0;transform:translate(4px,-18px) scale(1.2)} }
@keyframes heart-pop   { 0%{opacity:0;transform:translateY(0) scale(0.5)} 40%{opacity:1;transform:translateY(-14px) scale(1.2)} 100%{opacity:0;transform:translateY(-30px) scale(0.8)} }
@keyframes steam-rise  { 0%{height:0;opacity:0.7;transform:translateY(0)} 100%{height:18px;opacity:0;transform:translateY(-18px)} }
@keyframes eating-bob  { 0%,100%{transform:translateX(-50%) rotate(-5deg)} 50%{transform:translateX(-50%) rotate(5deg)} }
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
    <div class="ramen-bowl">&#x1F35C;</div>
    <div class="steam">
      <div class="steam-line"></div>
      <div class="steam-line"></div>
      <div class="steam-line"></div>
    </div>
    <div class="sleep-tint"></div>
    <img id="pet-img" class="pet-img" alt="pet" />
    <div class="css-pet" id="css-pet">
      <div class="cat-body">
        <div class="cat-tummy"></div>
        <div class="cat-paw-l"></div>
        <div class="cat-paw-r"></div>
      </div>
      <div class="cat-head">
        <div class="cat-ear-l"></div>
        <div class="cat-ear-r"></div>
        <div class="cat-eyes">
          <div class="eye"></div>
          <div class="eye"></div>
        </div>
        <div class="cat-blush-l"></div>
        <div class="cat-blush-r"></div>
        <div class="cat-nose"></div>
        <div class="cat-mouth" id="cat-mouth"></div>
      </div>
      <div class="cat-tail"></div>
    </div>
  </div>
  <div class="name-tag" id="name-tag">Mochi</div>
  <div class="hint">click to cheer up!</div>
</div>
`;
  }

  private script(
    assetJson: string, hasJson: string, personalityJson: string,
    activeCharJson: string, charactersJson: string, blinkJson: string,
  ): string {
    return `
var vscode      = acquireVsCodeApi();
var ASSETS      = ${assetJson};
var HAS         = ${hasJson};
var PERSONALITY = ${personalityJson};
var ACTIVE_CHAR = ${activeCharJson};
var CHARACTERS  = ${charactersJson};
var BLINK_CFG   = ${blinkJson};

var pet     = document.getElementById('pet');
var petImg  = document.getElementById('pet-img');
var cssPet  = document.getElementById('css-pet');
var bubble  = document.getElementById('bubble');
var badge   = document.getElementById('state-badge');
var nameTag = document.getElementById('name-tag');
var charBar = document.getElementById('char-bar');
var mouth   = document.getElementById('cat-mouth');

var currentState    = 'idle';
var previousState   = 'idle'; // ← track where we came from
var bubbleTimer     = null;
var blinkTimer      = null;
var blinkReturnTimer = null;
var mode = HAS ? 'image' : 'css';

function buildCharBar() {
  charBar.innerHTML = '';
  if (CHARACTERS.length === 0) {
    var hint = document.createElement('span');
    hint.className = 'no-chars';
    hint.textContent = 'Add folders to media/ to add characters';
    charBar.appendChild(hint);
    return;
  }
  CHARACTERS.forEach(function(ch) {
    var btn = document.createElement('button');
    btn.className = 'char-btn' + (ch.folder === ACTIVE_CHAR ? ' active' : '');
    btn.textContent = ch.name;
    btn.title = ch.folder;
    btn.onclick = function(e) {
      e.stopPropagation();
      vscode.postMessage({ type: 'switchCharacter', character: ch.folder });
    };
    charBar.appendChild(btn);
  });
}

function scheduleBlink() {
  if (!BLINK_CFG.enabled) { return; }
  clearTimeout(blinkTimer);
  var delay = BLINK_CFG.min + Math.random() * (BLINK_CFG.max - BLINK_CFG.min);
  blinkTimer = setTimeout(function() {
    if (currentState === 'idle') { doBlink(); }
    else { scheduleBlink(); }
  }, delay);
}

function doBlink() {
  // go to blinking state — silent, no bubble
  setStateInternal('blinking', false);
  var holdTime = Math.random() < 0.6 ? 120 : 230;
  blinkReturnTimer = setTimeout(function() {
    // return to idle — also silent, no bubble
    setStateInternal('idle', false);
    scheduleBlink();
  }, holdTime);
}

function stopBlink() {
  clearTimeout(blinkTimer);
  clearTimeout(blinkReturnTimer);
}

function setup() {
  nameTag.textContent = PERSONALITY.name;
  buildCharBar();
  if (mode === 'image') {
    cssPet.style.display = 'none';
    petImg.style.display = 'block';
    setImage('idle');
    scheduleBlink();
  }
}

function setImage(state) {
  var src = ASSETS[state] || ASSETS['idle'];
  if (!src) { return; }
  if (petImg.src !== src) { petImg.src = src; }
}

// ── Core state setter — showBubble controls whether dialogue fires ──
function setStateInternal(state, showBubble) {
  currentState = state;
  pet.className = 'pet state-' + state;
  badge.textContent = (state === 'blinking' ? 'Idle' : state.charAt(0).toUpperCase() + state.slice(1));

  if (mode === 'image') {
    if (state !== 'blinking') { stopBlink(); }
    setImage(state);
    if (state === 'idle') { scheduleBlink(); }
  }

  if (mouth) {
    if      (state === 'eating') { mouth.style.height = '8px'; mouth.style.borderRadius = '50%'; }
    else if (state === 'happy')  { mouth.style.height = '7px'; mouth.style.borderRadius = '0 0 8px 8px'; }
    else                         { mouth.style.height = '6px'; mouth.style.borderRadius = '0 0 8px 8px'; }
  }

  if (showBubble) { showBubbleText(pick(state)); }
}

// ── Public setState — always shows bubble (called from VS Code events) ──
function setState(state) {
  setStateInternal(state, true);
}

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

// Random idle chatter — only fires if pet has been idle for a while, not mid-blink
setInterval(function() {
  if (currentState === 'idle' && Math.random() < 0.3) {
    showBubbleText(pick('idle'));
  }
}, 12000);
`;
  }
}
