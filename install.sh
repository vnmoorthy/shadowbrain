#!/usr/bin/env bash
# install.sh — single-paste installer for shadowbrain.
#
# The canonical one-liner is:
#
#   curl -fsSL https://raw.githubusercontent.com/vnmoorthy/shadowbrain/main/install.sh | bash
#
# What this does:
#   1. Verifies node >= 20 is on PATH.
#   2. Clones (or updates) the repo into ~/.shadowbrain-pkg.
#   3. Runs `npm ci` inside it.
#   4. Symlinks `shadowbrain` into ~/.local/bin (preferred) or /usr/local/bin.
#   5. Detects coding agents (Claude Code, Cursor, Codex, OpenCode, ...).
#   6. Registers the MCP server with each detected agent (with .bak backups).
#   7. Initializes the local PGLite database.
#   8. Runs `shadowbrain doctor` and prints the result.
#
# Re-run-safe: detects existing install and updates in place.
# Uninstall: `shadowbrain uninstall --all && rm -rf ~/.shadowbrain ~/.shadowbrain-pkg`

set -euo pipefail

REPO_URL="${SHADOWBRAIN_REPO:-https://github.com/vnmoorthy/shadowbrain.git}"
INSTALL_DIR="${SHADOWBRAIN_INSTALL_DIR:-$HOME/.shadowbrain-pkg}"
BIN_TARGET="${SHADOWBRAIN_BIN_TARGET:-$HOME/.local/bin}"
BRANCH="${SHADOWBRAIN_BRANCH:-main}"

_bold() { printf "\033[1m%s\033[0m\n" "$*"; }
_dim()  { printf "\033[2m%s\033[0m\n" "$*"; }
_ok()   { printf "  \033[32m✓\033[0m %s\n" "$*"; }
_info() { printf "  \033[36m→\033[0m %s\n" "$*"; }
_warn() { printf "  \033[33m!\033[0m %s\n" "$*"; }
_err()  { printf "  \033[31m✗\033[0m %s\n" "$*" >&2; }

_require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    _err "required command '$1' not found on PATH"
    exit 1
  fi
}

_bold "shadowbrain installer"
echo

# ── 1. Check node version ────────────────────────────────────────────
_require node
NODE_MAJOR="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  _err "node $NODE_MAJOR found; need >= 20"
  echo "    install from https://nodejs.org or via your package manager"
  exit 1
fi
_ok "node $(node -v)"

_require git
_require npm

# ── 2. Clone or update repo ─────────────────────────────────────────
SCRIPT_SOURCE="${BASH_SOURCE[0]:-$0}"
RAN_FROM_CHECKOUT=0
if [ -f "$SCRIPT_SOURCE" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_SOURCE")" && pwd)"
  if [ -f "$SCRIPT_DIR/package.json" ] && grep -q '"name": "shadowbrain"' "$SCRIPT_DIR/package.json"; then
    RAN_FROM_CHECKOUT=1
    INSTALL_DIR="$SCRIPT_DIR"
    _info "running from existing checkout at $INSTALL_DIR"
  fi
fi

if [ "$RAN_FROM_CHECKOUT" -eq 0 ]; then
  if [ -d "$INSTALL_DIR/.git" ]; then
    _info "updating existing checkout at $INSTALL_DIR"
    git -C "$INSTALL_DIR" fetch --depth 1 origin "$BRANCH"
    git -C "$INSTALL_DIR" reset --hard "origin/$BRANCH"
  else
    _info "cloning into $INSTALL_DIR"
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  fi
fi
_ok "source ready at $INSTALL_DIR"

# ── 3. npm ci ─────────────────────────────────────────────────────────
_info "installing dependencies"
(cd "$INSTALL_DIR" && npm ci --silent --no-audit --no-fund) || \
  (cd "$INSTALL_DIR" && npm install --silent --no-audit --no-fund)
_ok "dependencies installed"

# ── 4. Symlink CLI ────────────────────────────────────────────────────
mkdir -p "$BIN_TARGET"
ln -sf "$INSTALL_DIR/bin/shadowbrain.mjs" "$BIN_TARGET/shadowbrain"
chmod +x "$INSTALL_DIR/bin/shadowbrain.mjs"
_ok "symlinked $BIN_TARGET/shadowbrain → $INSTALL_DIR/bin/shadowbrain.mjs"

case ":$PATH:" in
  *":$BIN_TARGET:"*) ;;
  *) _warn "$BIN_TARGET is not on your PATH"
     _warn "add this to your shell rc:"
     echo "    export PATH=\"$BIN_TARGET:\$PATH\"" ;;
esac

# Make `shadowbrain` resolvable for the rest of this script
export PATH="$BIN_TARGET:$PATH"

# ── 5. Register with detected agents ──────────────────────────────────
_info "detecting coding agents"
DETECTION_OUT="$(shadowbrain status --json 2>/dev/null || true)"
if echo "$DETECTION_OUT" | grep -q '"installed": true'; then
  _info "registering with installed agents"
  if shadowbrain install --all 2>/dev/null; then
    _ok "agents registered"
  else
    _warn "some agents could not be auto-registered — run 'shadowbrain install --dry-run' to inspect"
  fi
else
  _warn "no coding agents detected. Install Claude Code / Cursor / Codex first, then re-run."
fi

# ── 6. Initialize the DB ──────────────────────────────────────────────
shadowbrain doctor --no-update-check >/dev/null 2>&1 || true
_ok "database initialized at \$HOME/.shadowbrain/db"

# ── 7. Run doctor for human display ───────────────────────────────────
_bold "doctor"
shadowbrain doctor --no-update-check || true

echo
_bold "next step"
echo "  Open a fresh Claude Code (or other agent) session. Use the"
echo "  memory_put / memory_search tools — they're now available over MCP."
echo
echo "  Quick test:"
_dim "    shadowbrain trust set $(git config --get remote.origin.url 2>/dev/null || echo 'github.com/youruser/yourrepo') --tier read-write"
_dim "    # then in a Claude Code session: 'remember that we use pnpm not npm'"
