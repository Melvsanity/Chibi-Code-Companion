# Chibi Code Companion 🐱

A chibi anime companion that lives in your VS Code sidebar and reacts to what you're doing. Supports multiple characters, custom dialogue, and random blinking animations.

---

## Features

- Lives in the **Activity Bar** (left sidebar) — always visible while you code
- Reacts to VS Code events in real time
- Multiple characters with unique personalities
- Random blinking animation using your own images
- Speech bubbles with custom dialogue per character
- Switch characters instantly from the sidebar or Command Palette

---

## How It Reacts

| Event | Reaction |
|-------|----------|
| Typing / cursor move | Wakes up if sleeping |
| Save a file | Eats ramen 🍜 for 4 seconds |
| 60s of no activity | Falls asleep 😴 with floating Z's |
| Click the pet | Happy mode with hearts 💕 |
| Idle | Gentle bounce + random blinking |

---

## Setup

Make sure you have [Node.js](https://nodejs.org) installed, then:

```bash
npm install
npm run compile
```

Press **F5** in VS Code to launch the Extension Development Host. Look for the companion icon 🐱 in the left Activity Bar.

To install it permanently in your main VS Code:

```bash
npm install -g @vscode/vsce
vsce package
```

Then go to **Extensions → `...` menu → Install from VSIX** and select the generated `.vsix` file.

---

## Adding Characters

Each character lives in its own folder inside `media/`:

```
media/
  diana/
    idle.png          ← normal face (required)
    blinking.png      ← eyes closed / used for blink animation
    sleeping.png      ← 2-eyes closed, shown after inactivity
    eating.png        ← shown on file save (optional, falls back to idle)
    personality.json  ← display name + custom dialogue
  fern/
    idle.png
    blinking.png
    sleeping.png
    personality.json
  icon.svg
```

The extension **auto-detects** all folders in `media/` — no code changes needed. Just create a folder and it will appear in the character switcher automatically.

---

## personality.json

Controls the character's display name and what they say in each state:

```json
{
  "name": "Diana",
  "idle":     ["...", "watching you code", "hmph."],
  "eating":   ["finally a break!", "ramen > bugs"],
  "sleeping": ["wake me when it compiles...", "zzz..."],
  "happy":    ["o-ok you're not completely useless", "i guess that was acceptable"]
}
```

- The `name` field shows in the name tag and switcher buttons
- Each array is picked from randomly — add as many lines as you want
- All fields are optional — missing ones fall back to default dialogue

---

## Supported Image Formats

PNG, GIF, SVG, JPG, WEBP all supported. Mix formats freely across states.

| Filename | State | Notes |
|----------|-------|-------|
| `idle.png` | Normal coding | Required |
| `blinking.png` | Blink animation | Used for random blinks |
| `sleeping.png` | After 60s idle | Shown with floating Z's overlay |
| `eating.png` | On file save | Shown with ramen bowl overlay |

If a state image is missing it falls back to `idle.png` automatically.

---

## Switching Characters

**Option 1 — Sidebar buttons**
Click the character name buttons at the top of the companion panel.

**Option 2 — Command Palette**
`Ctrl+Shift+P` → **Chibi Code Companion: Switch Character**

Switching always resets to idle state.

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `chibiCompanion.activeCharacter` | `""` | Active character folder name |
| `chibiCompanion.blink.enabled` | `true` | Enable random blinking |
| `chibiCompanion.blink.minDelay` | `2000` | Min ms between blinks |
| `chibiCompanion.blink.maxDelay` | `6000` | Max ms between blinks |

Example `settings.json`:

```json
"chibiCompanion.activeCharacter": "diana",
"chibiCompanion.blink.enabled": true,
"chibiCompanion.blink.minDelay": 2000,
"chibiCompanion.blink.maxDelay": 6000
```

---

## Project Structure

```
chibi-code-companion/
  src/
    extension.ts      ← main extension logic
  out/
    extension.js      ← compiled output (auto-generated)
  media/
    icon.svg          ← activity bar icon
    diana/            ← character folder
    fern/             ← character folder
  package.json        ← extension manifest
  tsconfig.json       ← TypeScript config
  .vscode/
    launch.json       ← F5 debug config
```

---

## How the State System Works

```
VS Code Event
     ↓
extension.ts → setState()
     ↓
postMessage to Webview
     ↓
pet.className = 'pet state-eating'
     ↓
CSS shows ramen + steam overlay
img src swaps to eating.png
dialogue bubble shows random line
```

States: `idle` → `eating` → `sleeping` → `happy` → `blinking`

Blinking runs entirely inside the webview on a random timer — swaps to `blinking.png` silently for 120–230ms then returns to idle without triggering dialogue.
