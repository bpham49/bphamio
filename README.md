bphamio
=======

**bphamio** is a diagramming desktop app, forked from [draw.io desktop](https://github.com/jgraph/drawio-desktop) (which wraps the [core draw.io editor](https://github.com/jgraph/drawio)), with an agentic layer added on top. It reads and writes the exact same `.drawio` file format — files made here open fine in stock draw.io, and vice versa.

What's different from stock draw.io desktop:

- **A built-in local MCP server** (source in [`mcp/`](mcp/)) that lets Claude Code or Claude Desktop read and edit the diagram you have open, live, over HTTP on `127.0.0.1:37651` — no cloud round-trip, nothing extra to install. It runs inside the app itself: up while bphamio is running (including in the background with no windows open), gone when you quit. `Extras > MCP Setup…` shows its status and gives you the one-line command to connect Claude Code, or the config snippet for Claude Desktop.
- **A Claude side panel** (`View > Claude Panel`, or `Cmd/Ctrl+/`), docked next to the Format panel. Select shapes, type or dictate what to change, and your local Claude Code (`claude`, using your own login) edits the open diagram live. It can only use bphamio's own diagram tools, and only on files you opened or saved yourself.
- **A native freehand pencil tool** (`Extras > Freehand Draw`, or press `P`), drawn as an ordinary curved `mxCell` edge — fully compatible with vanilla draw.io, no custom shape class.
- **Autosave forced on**, unconditionally — needed for the live agent-editing workflow to actually show up on screen without a manual save.

Attribution and license
------------------------

draw.io is a trademark of JGraph Ltd / draw.io AG. Per the [upstream trademark notice](drawio/README.md#trademark), bphamio uses its own name and icon everywhere in the app; "draw.io" only appears where it describes the upstream project or file format, and in the browser user-agent token the editor uses to detect desktop mode.

This is a derivative work of [jgraph/drawio-desktop](https://github.com/jgraph/drawio-desktop) (GPL-3.0-only) and [jgraph/drawio](https://github.com/jgraph/drawio) (Apache-2.0), both © JGraph Ltd / draw.io AG. All original copyright notices and license headers are preserved as-is in the source. bphamio's own additions are licensed GPL-3.0-only, same as the project it extends. See [LICENSE](LICENSE).

This is an independent personal fork, not affiliated with or endorsed by JGraph or draw.io AG.

Download
--------

This is an unsigned, personal build — see [doc/BUILDING_FOR_PERSONAL_USE.md](doc/BUILDING_FOR_PERSONAL_USE.md) for what that means and how to build it yourself. Built binaries, when published, land on the [releases page](https://github.com/bpham49/bphamio/releases) as `bphamio-<version>` artifacts (same installer types as upstream: NSIS/MSI/zip on Windows, AppImage/deb/rpm on Linux, dmg on macOS).

Developing
----------

**drawio** is a git submodule, forked separately to [bpham49/drawio](https://github.com/bpham49/drawio) so the editor-side customizations (the freehand plugin, the autosave fix) travel with it. Clone recursively:

```
git clone --recursive https://github.com/bpham49/bphamio.git
```

Then:
1. `npm install` (in the root directory of this repo)
2. `export DRAWIO_ENV=dev` to develop/debug with unminified sources and DevTools
3. `npm start` bundles the MCP server (`npm run build-mcp`: `mcp/` → `src/main/mcp-server.bundle.js`) and runs the app from source. For debugging, use `npm start --enable-logging`.

The editor bundle (`drawio/src/main/webapp/js/app.min.js`) is built from the sources in `drawio/src/main/webapp/js/` with Apache Ant and the bundled Closure Compiler: `cd drawio/etc/build && ant app` (needs Java 17+). CI does this on every build, so source edits always ship; rebuild locally after editing editor sources if you want the packaged-mode bundle to match (dev mode loads the sources directly).

The MCP server can also run on its own, outside the app (e.g. against stock draw.io): `cd mcp && npm ci && npm start`. Its tests: `npm test` and `npm run typecheck` in `mcp/`.

Note: If a symlink is used to refer to the drawio repo (instead of the submodule), symlink `node_modules` inside `drawio/src/main/webapp` too.

To build a local unsigned installer, see [doc/BUILDING_FOR_PERSONAL_USE.md](doc/BUILDING_FOR_PERSONAL_USE.md).

Local storage and session storage live in the AppData folder (unchanged from upstream, since the bundle/app identifiers were updated to avoid colliding with an existing draw.io install — see `appId`/`CFBundleIdentifier` in the `electron-builder-*.json` configs):

- macOS: `~/Library/Application Support/draw.io`
- Windows: `C:\Users\<USER-NAME>\AppData\Roaming\draw.io\`

Security
--------

Same security posture as upstream draw.io desktop: isolated from the internet apart from the (optional) update check, Content Security Policy forbids remotely-loaded JavaScript, no diagram content or usage analytics sent externally. The one addition — the local MCP server — only listens on `127.0.0.1`, never leaves the machine.

No diagram data is ever sent externally. A diagram can reference external media (an image, background or font loaded from a URL embedded in the diagram), and those are fetched when the diagram opens; opening a diagram from an untrusted source can therefore trigger a request that reveals metadata like your IP address to that server, though no diagram content is transmitted.

Updates
-------

Auto-update checks are disabled in this fork's personal build config (`npm run sync -- disableUpdate`), so a modified build doesn't silently replace itself with an unmodified official release.
