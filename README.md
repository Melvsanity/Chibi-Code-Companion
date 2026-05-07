<div align="center">

# Chibi Code Companion

**A chibi anime companion that lives in your VS Code sidebar.**  
Reacts to your coding activity, supports multiple characters, and keeps you company while you work.

![Version](https://img.shields.io/badge/version-2.1.0-pink?style=flat-square)
![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.74.0-blue?style=flat-square&logo=visualstudiocode)
![License](https://img.shields.io/badge/license-MIT-purple?style=flat-square)

</div>

---

## ✨ Features

- 🏠 Lives in the **Activity Bar** — always visible while you code, never in the way
- 💬 **Speech bubbles** with custom per-character dialogue
- 👁️ **Random blinking** animation for a natural, living feel
- 🎭 **Multiple characters** — each with their own personality and art
- ⚡ Reacts to real VS Code events in real time
- 🔄 Switch characters instantly from the sidebar or Command Palette
- 🖼️ Supports PNG, GIF, SVG, JPG, WEBP image formats

---

## 🎬 How It Reacts

| VS Code Event | Animation | Overlay |
|---------------|-----------|---------|
| Typing / cursor move | Wakes up from sleep | — |
| **Save a file** | Eating animation | Eating RAM |
| **60s of inactivity** | Sleeping animation | 💤 Floating Z's |
| **Click the pet** | Happy animation | 💕 Floating hearts |
| **Idle** | Gentle bounce + random blink | — |

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org) (LTS version recommended)
- [VS Code](https://code.visualstudio.com) 1.74.0 or higher

### Run in Development
```bash
npm install
npm run compile
```
Press **F5** to launch the Extension Development Host.  
Look for the 🐱 icon in the left Activity Bar and click it.

### Install Permanently (VSIX)
```bash
npm install -g @vscode/vsce
npm run compile
vsce package
```
Then in VS Code: **Extensions sidebar → `...` menu → Install from VSIX** → select the `.vsix` file.

### Publish to Marketplace
```bash
vsce login yourpublisherid
vsce publish
```

---

## 🎨 Adding Characters

Each character is a self-contained folder inside `media/`. No code changes needed — the extension auto-detects all character folders on startup.

```
media/
├── diana/
│   ├── idle.png          ← normal face (required)
│   ├── blinking.png      ← used for random blink animation
│   ├── sleeping.png      ← shown after 60s of inactivity
│   ├── eating.png        ← shown on file save (falls back to idle)
│   └── personality.json  ← display name + dialogue lines
├── fern/
│   ├── idle.png
│   ├── blinking.png
│   ├── sleeping.png
│   └── personality.json
└── icon.svg
```

> **Tip:** GIFs work too! Use an animated GIF for `idle.gif` and your character will play a looping animation while you code.

---

## 💬 personality.json

Each character folder can have a `personality.json` that defines their name and what they say in each state.

```json
{
  "name": "Diana",
  "idle": [
    "...",
    "watching you code",
    "fix it already",
    "hmph."
  ],
  "eating": [
    "finally a break!",
    "ramen > your bugs",
    "d-don't watch me eat!"
  ],
  "sleeping": [
    "wake me when it compiles...",
    "zzz... i'm not sleeping",
    "don't draw on my face"
  ],
  "happy": [
    "o-ok you're not completely useless",
    "i guess that was... acceptable",
    "don't read too much into this!"
  ]
}
```

| Field | Description |
|-------|-------------|
| `name` | Shown in the name tag and character switcher buttons |
| `idle` | Said randomly while you're coding normally |
| `eating` | Said when a file is saved |
| `sleeping` | Said when falling asleep after inactivity |
| `happy` | Said when you click the pet |

All fields are optional — missing ones fall back to built-in default dialogue.  
Add as many lines per array as you want — one is picked at random each time.

---

## 🖼️ Image Reference

| Filename | Triggered by | Overlays applied |
|----------|-------------|-----------------|
| `idle.png` | Default state | Bounce animation |
| `blinking.png` | Random timer (2–6s) | None — silent swap |
| `sleeping.png` | 60s of inactivity | Floating Z's, blue tint |
| `eating.png` | File save | Ramen bowl 🍜, steam |
| `happy.png` *(optional)* | Click pet | Floating hearts 💕 |

**Supported formats:** PNG · GIF · SVG · JPG · JPEG · WEBP

If a state image is missing, it automatically falls back to `idle.png`.

---

## 🔀 Switching Characters

**Option 1 — Sidebar buttons**  
Click any character name button at the top of the companion panel.

**Option 2 — Command Palette**  
`Ctrl+Shift+P` → type **Chibi Code Companion: Switch Character**

Switching always resets the companion to idle state.

---

## ⚙️ Settings

Open VS Code Settings (`Ctrl+,`) and search for `chibiCompanion`, or edit `settings.json` directly:

```json
{
  "chibiCompanion.activeCharacter": "diana",
  "chibiCompanion.blink.enabled": true,
  "chibiCompanion.blink.minDelay": 2000,
  "chibiCompanion.blink.maxDelay": 6000
}
```

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `chibiCompanion.activeCharacter` | string | `""` | Active character folder name |
| `chibiCompanion.blink.enabled` | boolean | `true` | Enable/disable random blinking |
| `chibiCompanion.blink.minDelay` | number | `2000` | Minimum ms between blinks |
| `chibiCompanion.blink.maxDelay` | number | `6000` | Maximum ms between blinks |

---

## 📁 Project Structure

```
chibi-code-companion/
├── src/
│   └── extension.ts        ← main extension logic (TypeScript)
├── out/
│   └── extension.js        ← compiled output (auto-generated, do not edit)
├── media/
│   ├── icon.svg            ← activity bar icon
│   ├── icon.png            ← marketplace icon (128x128)
│   ├── diana/              ← character folder
│   └── fern/               ← character folder
├── .vscode/
│   └── launch.json         ← F5 debug configuration
├── package.json            ← extension manifest
├── tsconfig.json           ← TypeScript configuration
└── README.md
```

---

## 🧠 How It Works

```
VS Code fires an event (save, type, click...)
            │
            ▼
    extension.ts detects it
    calls setState('eating')
            │
            ▼
    postMessage() sends state
    to the Webview
            │
            ▼
    Webview JS receives state
    swaps image src → eating.png
    adds CSS class → state-eating
    shows random dialogue bubble
            │
            ▼
    CSS reacts to .state-eating
    shows ramen bowl overlay
    plays steam animation
```

### State Machine

```
        ┌─────────────────────────────┐
        │                             │
   ┌────▼────┐    save file    ┌──────┴──────┐
   │  idle   │───────────────► │   eating    │
   └────┬────┘                 └──────┬──────┘
        │                             │ after 4s
        │ 60s idle                    ▼
        │                        back to idle
        ▼
   ┌──────────┐    click pet   ┌─────────────┐
   │ sleeping │                │    happy    │
   └──────────┘                └─────────────┘
        ▲                             │ after 3s
        │         any activity        ▼
        └────────────────────────back to idle

   ┌──────────┐  ← random 2-6s timer, silent, no dialogue
   │ blinking │
   └──────────┘  → returns to idle automatically
```

---

## 📝 License

MIT — do whatever you want with it. If you make a cool character, share it! 🐱