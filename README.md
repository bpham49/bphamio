bphamio
=======

**bphamio** is a diagramming desktop app, forked from [draw.io desktop](https://github.com/jgraph/drawio-desktop) (which wraps the [core draw.io editor](https://github.com/jgraph/drawio)), with an agentic layer added on top. It reads and writes the exact same `.drawio` file format — files made here open fine in stock draw.io, and vice versa.

What's different from stock draw.io desktop:

- **A local MCP server** ([`bpham/drawing-agent`](https://github.com/bpham/drawing-agent)) that lets Claude Code or Claude Desktop read and edit the diagram you have open, live, over HTTP on `127.0.0.1` — no cloud round-trip. This app spawns that server automatically and reports which file is open to it.
- **A native freehand pencil tool** (`Extras > Freehand Draw`, or press `P`), drawn as an ordinary curved `mxCell` edge — fully compatible with vanilla draw.io, no custom shape class.
- **Autosave forced on**, unconditionally — needed for the live agent-editing workflow to actually show up on screen without a manual save.

Attribution and license
------------------------

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
3. `npm start` runs the app from source. For debugging, use `npm start --enable-logging`.

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
