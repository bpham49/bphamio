import http from 'node:http'
import { spawn } from 'node:child_process'

// drawio-agentic: keeps the local MCP server (../../../src/mcp-server.ts in the
// sibling project) running alongside this app, and tells it which file is open
// so Claude can act on "the diagram you're looking at" without being told a path.
const PORT = 37651
// ponytail: defaults to the author's checkout; anyone else sets
// BPHAMIO_MCP_SERVER to their own mcp-server.ts. Bundle the server into the
// app when it needs to work with zero setup.
const MCP_SERVER_PATH = process.env.BPHAMIO_MCP_SERVER ?? '/Users/nguyen/Dev/drawing-agent/src/mcp-server.ts'

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

// Spawned detached: closing every window doesn't quit a macOS app (it lingers
// in the dock), and the server should keep running through that, same as the
// app does — stopMcpServer() below is what actually ends its lifecycle, tied
// to app.on('will-quit'), the true-quit event, not window-all-closed.
export async function ensureMcpServerRunning()
{
	if (await checkHealth()) return

	try
	{
		const child = spawn('node', [MCP_SERVER_PATH], { detached: true, stdio: 'ignore' })
		child.unref()
	}
	catch (e)
	{
		console.error('drawio-agentic: failed to start MCP server', e)
	}
}

// Called from app.on('will-quit') — best-effort, and deliberately not awaited
// by the caller: app quit must never hang on this.
export function stopMcpServer()
{
	try
	{
		const req = http.request(`http://127.0.0.1:${PORT}/shutdown`, { method: 'POST', timeout: 500 }, (res) => res.resume())
		req.on('error', () => {})
		req.on('timeout', () => req.destroy())
		req.end()
	}
	catch (e)
	{
		// best-effort; a stray server process next launch just fails the health
		// check and gets replaced
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
