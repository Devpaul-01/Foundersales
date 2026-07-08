# Walkthrough System — Integration Guide

## 1. Install Framer Motion (if not already installed)

```bash
npm install framer-motion
```

---

## 2. Copy the folder

Place the entire `walkthrough/` folder at:

```
src/components/walkthrough/
├── index.js
├── steps.js
├── WalkthroughContext.jsx
├── WalkthroughOverlay.jsx
└── WalkthroughResumeButton.jsx
```

---

## 3. Wrap your app with WalkthroughProvider

`WalkthroughProvider` uses `useNavigate` internally, so it **must be placed inside your Router**.

Find the file where your `<Routes>` / `<BrowserRouter>` lives (likely `src/App.jsx` or `src/main.jsx`) and wrap your authenticated layout:

```jsx
// src/App.jsx (example — adapt to your actual structure)

import { WalkthroughProvider, WalkthroughOverlay, WalkthroughResumeButton }
  from './components/walkthrough'

// Inside the component that wraps authenticated routes:
function AuthenticatedApp() {
  return (
    <WalkthroughProvider>
      {/* Your existing layout / navbar / sidebar */}
      <YourLayout>
        <Routes>
          {/* ...your existing routes... */}
        </Routes>
      </YourLayout>

      {/* Walkthrough UI — rendered on top of everything */}
      <WalkthroughOverlay />
      <WalkthroughResumeButton />
    </WalkthroughProvider>
  )
}
```

> **Important:** `WalkthroughProvider` must be a **descendant of your Router** (BrowserRouter / MemoryRouter) because it calls `useNavigate()` internally.

---

## 4. Auto-start behavior

The walkthrough **auto-starts** for users who:
- Have `user.onboarding_completed === true`
- Have **no saved walkthrough progress** in localStorage

This means: the first time a new user lands on the dashboard after completing onboarding, the tour launches automatically after a 1.2s delay (enough time for the dashboard to paint first).

No extra code needed — this is handled inside `WalkthroughContext`.

---

## 5. Progress persistence

Progress is saved automatically to:

```
localStorage key: fs_walkthrough_<userId>
```

Stored value:
```json
{
  "currentStep": 4,
  "isCompleted": false,
  "startedAt": "2025-01-01T09:00:00.000Z",
  "lastActiveAt": "2025-01-01T10:30:00.000Z"
}
```

This happens on every step change and on every close.  
No backend changes, no new database tables required.

---

## 6. Manually trigger the tour (optional)

If you want a "Take the tour" button anywhere in your settings or nav:

```jsx
import { useWalkthrough } from '../components/walkthrough'

function SettingsPage() {
  const { start } = useWalkthrough()

  return (
    <button onClick={() => start(0)}>
      Take the product tour
    </button>
  )
}
```

---

## 7. What the user sees

| Situation | Behavior |
|-----------|----------|
| New user, onboarding just completed | Tour auto-starts after 1.2s |
| User closes the tour mid-way | Tour stops immediately. Progress saved. |
| User returns later | Resume button appears bottom-right |
| User clicks Resume | Tour reopens at the exact step they left |
| User completes the tour | Tour closes. Resume button shows "Tour" with restart option |
| User restarts | Progress cleared, tour begins from Step 0 |

---

## 8. Keyboard shortcuts (shown in a hint pill)

| Key | Action |
|-----|--------|
| `←` or `→` | Navigate steps |
| `Space` | Pause / Resume auto-play |
| `Esc` | Close tour (saves progress) |

---

## 9. One assumption to verify

The context reads `user.archetype` from `useAuthStore()` to show personalized starter actions on the finale slide.

Make sure `useAuthStore` is imported from `../../stores/authStore` relative to the walkthrough files, or update the import path in:
- `WalkthroughContext.jsx` (line ~8)
- `WalkthroughOverlay.jsx` (line ~14)

Both files already import it as:
```js
import { useAuthStore } from '../../stores/authStore'
```

If your store is at a different path, do a find-and-replace on that import.

---

## 10. Adjusting step content

All 17 step definitions live in `steps.js`. Each step is a plain object — edit text, icons, bullet points, or `autoDuration` (in ms) freely without touching any other file.

```js
// steps.js — example of changing a step
{
  id: 'opportunities',
  stepNumber: 1,
  icon: '🎯',
  feature: 'Find Your Next Lead',
  tagline: 'Clutch finds real people with your exact problem — and writes the message.',
  description: '...',
  clutchDoes: ['...', '...', '...'],
  action: 'Check your first lead →',
  routePath: '/opportunities',
  autoDuration: 10000,   // 10 seconds before auto-advancing
}
```

Set `autoDuration: 0` on any step to disable auto-advance for that step only.
