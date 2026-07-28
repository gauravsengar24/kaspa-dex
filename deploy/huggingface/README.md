# KaspaSwap on HuggingFace Spaces

## Deploy Steps

### 1. Create a HuggingFace Space

1. Go to https://huggingface.co/new-space
2. Set Space name: `kaspa-swap`
3. License: MIT
4. SDK: Docker
5. Space hardware: CPU (free) or CPU upgrade

### 2. Push to Space

```bash
# Clone your space
git clone https://huggingface.co/spaces/YOUR_USER/kaspa-swap
cd kaspa-swap

# Copy deploy files to root
cp -r /path/to/kaspa-dex-ui/deploy/huggingface/* .
cp -r /path/to/kaspa-dex-ui/backend .
cp -r /path/to/kaspa-dex-ui/frontend .

git add .
git commit -m "Initial deploy: KaspaSwap L1 DEX"
git push
```

### 3. Configure Environment Variables

Set these in Space settings:
- `VITE_API_URL`: Backend URL (auto-set on HF)
- `KASPA_NODE_URL`: Kaspa node wRPC endpoint

### 4. Access

Your DEX will be live at: `https://YOUR_USER-kaspa-swap.hf.space`

## Architecture

```
User Browser ──► HuggingFace Space (port 7860)
                         │
                    FastAPI Server
                         │
              ┌──────────┼──────────┐
              │          │          │
         Frontend   Orderbook   Kaspa Node
         (Static)   (In-Mem)    (wRPC/API)
```

## Kaspa Node Connection

The backend connects to Kaspa Testnet-12 by default.
For production, set `KASPA_NODE_URL` to your own node.
# Built at Tue Jul 28 15:58:13 IST 2026
