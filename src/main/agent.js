import { spawn, execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// bphamio's in-app agent: runs the user's own Claude Code headless (claude -p)
// against the diagram they're looking at, and streams what it does back to the
// agent panel. Using Claude Code (not the API directly) means no API key to
// manage, the user's own login/model, their CLAUDE.md and their other MCP
// servers all come along.
//
// Security: the prompt goes over stdin and every argument is a separate argv
// element with no shell, so nothing the user types is ever interpreted as a
// command. Tools are limited to bphamio's own diagram tools by default — the
// renderer that triggers this is a web page that can open untrusted diagrams,
// so it must not be able to hand Claude file-reading or shell tools.

const MCP_URL = 'http://127.0.0.1:37651/mcp'
const ALLOWED_TOOLS = ['mcp__bphamio']

let claudePath = null
let running = null

function candidates()
{
	const home = os.homedir()
	return [
		path.join(home, '.local', 'bin', 'claude'),
		path.join(home, '.claude', 'local', 'claude'),
		'/opt/homebrew/bin/claude',
		'/usr/local/bin/claude',
	]
}

// A Finder-launched app gets a bare PATH (/usr/bin:/bin...), so `claude` is
// usually not on it. Check the usual install locations, then ask the user's
// login shell — with a fixed command string, no user input involved.
function resolveClaude()
{
	if (claudePath != null) return Promise.resolve(claudePath)

	const hit = candidates().find((p) => fs.existsSync(p))
	if (hit) return Promise.resolve(claudePath = hit)

	return new Promise((resolve) =>
	{
		execFile(process.env.SHELL || '/bin/zsh', ['-ilc', 'command -v claude'], { timeout: 5000 }, (err, stdout) =>
		{
			const line = (stdout || '').split('\n').map((s) => s.trim()).reverse().find((s) => s.startsWith('/'))
			resolve(claudePath = (!err && line && fs.existsSync(line)) ? line : null)
		})
	})
}

function systemPrompt(filePath, page, selection)
{
	const sel = (selection && selection.length > 0)
		? 'Currently selected in the editor — when the user says "this", "these" or "it", they mean these cells:\n' +
			selection.map((c) => `- ${c.kind} id=${c.id}` + (c.label ? ` label=${JSON.stringify(c.label)}` : '')).join('\n')
		: 'Nothing is selected in the editor.'

	return [
		'You are the agent inside bphamio, a draw.io-compatible desktop diagram editor.',
		`The user is looking at this diagram file: ${filePath}`,
		page ? `They are on the page named ${JSON.stringify(page)} — pass page: ${JSON.stringify(page)} to the bphamio tools.` : '',
		'Edit it only through the bphamio MCP tools, always passing that path. Call get_graph before changing anything,',
		'change only what was asked, and keep the existing layout and styles unless asked otherwise.',
		'If a tool response reports layout issues, fix them before you finish.',
		'Changes appear in the user\'s window on their own. Finish with one or two short sentences saying what you changed.',
		sel,
	].filter(Boolean).join('\n')
}

function summarizeToolInput(input)
{
	if (!input) return ''
	const bits = []
	for (const k of ['label', 'id', 'source', 'target', 'name', 'direction'])
	{
		if (input[k] != null && input[k] !== '') bits.push(`${k}=${String(input[k]).slice(0, 40)}`)
	}
	return bits.join(' ')
}

function send(sender, evt)
{
	if (!sender.isDestroyed()) sender.send('agentEvent', evt)
}

export async function agentAsk(sender, { prompt, filePath, page, selection, sessionId })
{
	if (running != null) throw new Error('Claude is already working on a request — wait for it or press Stop.')
	if (typeof prompt !== 'string' || prompt.trim() === '') throw new Error('Empty prompt')
	if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('Save the diagram to a file first.')

	const bin = await resolveClaude()
	if (bin == null) throw new Error('Claude Code (the `claude` command) was not found. Install it from https://claude.com/claude-code and sign in once.')

	const args = [
		'-p',
		'--output-format', 'stream-json',
		'--verbose',
		'--mcp-config', JSON.stringify({ mcpServers: { bphamio: { type: 'http', url: MCP_URL } } }),
		'--allowedTools', ...ALLOWED_TOOLS,
		'--append-system-prompt', systemPrompt(filePath, page, selection),
	]

	if (typeof sessionId === 'string' && /^[0-9a-f-]{36}$/i.test(sessionId)) args.push('--resume', sessionId)

	const child = spawn(bin, args, {
		cwd: path.dirname(filePath),
		env: { ...process.env, PATH: [path.dirname(bin), '/opt/homebrew/bin', '/usr/local/bin', process.env.PATH].join(':') },
		stdio: ['pipe', 'pipe', 'pipe'],
	})

	running = child
	child.stdin.end(prompt)

	let buf = ''
	let stderr = ''
	let finished = false

	child.stdout.on('data', (chunk) =>
	{
		buf += chunk
		let nl
		while ((nl = buf.indexOf('\n')) >= 0)
		{
			const line = buf.slice(0, nl).trim()
			buf = buf.slice(nl + 1)
			if (!line) continue

			let e
			try { e = JSON.parse(line) } catch (err) { continue }

			if (e.type === 'system' && e.subtype === 'init')
			{
				const ours = (e.mcp_servers || []).find((s) => s.name === 'bphamio')
				send(sender, { kind: 'init', sessionId: e.session_id, mcpConnected: ours ? ours.status === 'connected' : false })
			}
			else if (e.type === 'assistant' && e.message && Array.isArray(e.message.content))
			{
				for (const c of e.message.content)
				{
					if (c.type === 'text' && c.text) send(sender, { kind: 'text', text: c.text })
					else if (c.type === 'tool_use') send(sender, { kind: 'tool', name: String(c.name).replace(/^mcp__bphamio__/, ''), detail: summarizeToolInput(c.input) })
				}
			}
			else if (e.type === 'result')
			{
				finished = true
				send(sender, { kind: 'done', sessionId: e.session_id, isError: !!e.is_error, result: typeof e.result === 'string' ? e.result : '' })
			}
		}
	})

	child.stderr.on('data', (c) => { stderr += c; if (stderr.length > 8000) stderr = stderr.slice(-8000) })

	child.on('error', (err) =>
	{
		running = null
		send(sender, { kind: 'error', message: String(err && err.message || err) })
	})

	child.on('close', (code, signal) =>
	{
		running = null
		if (!finished)
		{
			send(sender, signal === 'SIGTERM'
				? { kind: 'stopped' }
				: { kind: 'error', message: (stderr.trim().split('\n').slice(-3).join('\n')) || `claude exited with code ${code}` })
		}
	})

	return { started: true }
}

export function agentCancel()
{
	if (running != null) running.kill('SIGTERM')
}
