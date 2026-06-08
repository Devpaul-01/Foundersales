# Multi-Provider Setup Guide
## Cerebras · Groq · Mistral

---

## 1. Cerebras (Highest Priority — ~60K TPM free)

**Sign up:**
1. Go to https://cloud.cerebras.ai
2. Click **Sign Up** — you can use Google or email
3. Verify your email if needed

**Get API Key:**
1. Once logged in, go to the left sidebar → **API Keys**
2. Click **Create New API Key**
3. Give it a name (e.g. `my-app-key-1`)
4. Copy the key immediately — it won't be shown again

**Models you're using:**
- `llama3.1-8b` — primary (fastest, highest TPM)
- `llama3.3-70b` — fallback (smarter, slightly lower TPM)

---

## 2. Groq (Second Priority — ~30K TPM free)

**Sign up:**
1. Go to https://console.groq.com
2. Click **Sign Up** — Google sign-in available
3. Verify your email

**Get API Key:**
1. In the dashboard, click **API Keys** in the left sidebar
2. Click **Create API Key**
3. Name it and copy it immediately

**Model change (what was updated in your code):**
Your code previously used `llama-3.1-8b-instant` as primary — that's already the highest-TPM model on Groq's free tier, so no model change was needed. It stays as-is.

---

## 3. Mistral (Third Priority — 500K TPM free*)

> ⚠️ **Privacy note:** Mistral's free tier may use your prompts to train their models. If your app handles sensitive user data, skip Mistral or upgrade to their paid tier.

**Sign up:**
1. Go to https://console.mistral.ai
2. Click **Sign Up** — Google sign-in available
3. Verify your email

**Get API Key:**
1. Go to **API Keys** in the left sidebar
2. Click **Create new key**
3. Copy it immediately

**Models you're using:**
- `open-mistral-7b` — primary (fully free, open weights)
- `open-mixtral-8x7b` — fallback (MoE model, still free)

---

## 4. Setting Up Your .env File

```env
# ─── Cerebras ───────────────────────────────
CEREBRAS_API_KEY_1=csk-xxxxxxxxxxxxxxxxxxxxxxxx
CEREBRAS_API_KEY_2=csk-yyyyyyyyyyyyyyyyyyyyyyyy
# Add up to CEREBRAS_API_KEY_5

# ─── Groq ───────────────────────────────────
GROQ_API_KEY_1=gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GROQ_API_KEY_2=gsk_yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy
# Add up to GROQ_API_KEY_10

# ─── Mistral ────────────────────────────────
MISTRAL_API_KEY_1=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
MISTRAL_API_KEY_2=yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy
# Add up to MISTRAL_API_KEY_5
```

**Single key setup (if you only have one per provider):**
```env
CEREBRAS_API_KEY=csk-56tmjecmxfpr4txe95dm2vy9wmvjdmcxr2w8jenpncdr2wr2
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
MISTRAL_API_KEY=7E1sVRu1fvALm2hXREhKjSRSio8TpdRI
```

The code handles both formats automatically.

---

## 5. What Was Changed in multiProvider.js

| Change | Details |
|---|---|
| **Groq no longer imported** | `callGroq`/`streamGroq` from `groq.js` are replaced by a generic OpenAI-compatible fetch. You can keep `groq.js` but it's no longer used by this file. |
| **Cerebras added** | First in the fallback chain. ~60K TPM free, same Llama models. |
| **Mistral added** | Last in the chain. 500K TPM but privacy tradeoff. |
| **Error classification** | Now provider-agnostic — matches HTTP status codes that all three APIs return. |
| **Cooldown keys** | Now scoped as `provider-keyIndex` (e.g. `cerebras-1`) so Cerebras and Groq cooldowns don't collide. |
| **getProviderStatus()** | Now returns all three providers in one list, useful for a `/admin/status` endpoint. |

---

## 6. Fallback Order at Runtime

```
Request comes in
      │
      ▼
[Cerebras key 1] llama3.1-8b   ──fail──▶ [Cerebras key 2] llama3.1-8b  ──...
      │ success
      ▼
  Return response ✓

If all Cerebras keys exhausted:
      │
      ▼
[Groq key 1] llama-3.1-8b-instant ──fail──▶ [Groq key 2] ...
      │ success
      ▼
  Return response ✓

If all Groq keys exhausted:
      │
      ▼
[Mistral key 1] open-mistral-7b ──fail──▶ [Mistral key 2] ...
      │ success
      ▼
  Return response ✓

If everything fails → throws ALL_PROVIDERS_FAILED
```

---

## 7. Checking Provider Health (Debug)

Call `getProviderStatus()` from your admin route:

```js
import { getProviderStatus } from './services/multiProvider.js';

app.get('/admin/providers', (req, res) => {
  res.json(getProviderStatus());
});
```

Example response:
```json
[
  { "provider": "cerebras", "key_index": 1, "status": "healthy", "fail_count": 0 },
  { "provider": "cerebras", "key_index": 2, "status": "cooling", "fail_count": 2, "cooling_until": "2026-05-26T15:00:00Z" },
  { "provider": "groq",     "key_index": 1, "status": "healthy", "fail_count": 0 },
  { "provider": "mistral",  "key_index": 1, "status": "healthy", "fail_count": 0 }
]
```
