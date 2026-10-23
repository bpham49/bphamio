import http from 'node:http'

// bphamio: runs the local MCP server (mcp/, bundled by `npm run build-mcp`
// into mcp-server.bundle.js) inside this Electron main process, and tells it
// which file is open so Claude can act on "the diagram you're looking at"
// without being told a path. In-process means its lifecycle is the app's:
// it keeps running while the app lingers in the macOS dock with no windows,
// and stops when the app truly quits — no separate process to spawn or kill.
const PORT = 37651
let ownedServer = null

function checkHealth()
{
	return new Promise((resolve) =>
	{
		const req = http.get(`http://127.0.0.1:${PORT}/health`, { timeout: 500 }, (res) =>
		{
			resolve(res.statusCode === 200)
			res.resume()
		})
		req.on('error', () => resolve(false))
		req.on('timeout', () => { req.destroy(); resolve(false) })
	})
}

function getActiveFile()
{
	return new Promise((resolve) =>
	{
		const req = http.get(`http://127.0.0.1:${PORT}/active-file`, { timeout: 500 }, (res) =>
		{
			let body = ''
			res.on('data', (c) => (body += c))
			res.on('end', () =>
			{
				try { resolve(JSON.parse(body).path ?? null) }
				catch (e) { resolve(null) }
			})
		})
		req.on('error', () => resolve(null))
		req.on('timeout', () => { req.destroy(); resolve(null) })
	})
}

// Used by the mcp-setup plugin's status panel — fetched from the main process
// because the renderer's own CSP (connect-src 'self') blocks it from reaching
// 127.0.0.1 directly, even though it's local.
export async function getMcpStatus()
{
	const running = await checkHealth()
	const activeFile = running ? await getActiveFile() : null
	return { running, port: PORT, url: `http://127.0.0.1:${PORT}/mcp`, activeFile }
}

export async function ensureMcpServerRunning()
{
	try
	{
		const { startMcpServer } = await import('./mcp-server.bundle.js')
		ownedServer = await startMcpServer({ port: PORT })
	}
	catch (e)
	{
		// EADDRINUSE: something already serves this port (a standalone
		// `npm start` in mcp/, say). Leave it be — the status panel and
		// reportActiveFile talk to whichever server answers on PORT.
		if (e && e.code !== 'EADDRINUSE')
		{
			console.error('bphamio: failed to start MCP server', e)
		}
	}
}

export function stopMcpServer()
{
	if (ownedServer != null)
	{
		ownedServer.close()
		ownedServer = null
	}
}

// Best-effort, fire-and-forget — the server may not be running yet (e.g. first
// launch, still starting), and a save must never block on this.
export function reportActiveFile(filePath)
{
	if (filePath == null) return

	try
	{
		const data = JSON.stringify({ path: filePath })
		const req = http.request(`http://127.0.0.1:${PORT}/active-file`,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
			timeout: 500,
		}, (res) => res.resume())
		req.on('error', () => {})
		req.on('timeout', () => req.destroy())
		req.write(data)
		req.end()
	}
	catch (e)
	{
		// never let a reporting failure affect the actual save
	}
}
