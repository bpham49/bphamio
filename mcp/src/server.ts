import { createServer as createHttpServer } from 'node:http';
import type { Server } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { readGraph, addNode, addEdge, updateCell, deleteCell, createDiagram, listPages, addPage } from './drawio-xml.ts';
import type { PageSelector } from './drawio-xml.ts';
import { runLayout } from './layout.ts';
import { evaluateDiagram, formatIssues } from './critic.ts';

// Appended to every mutating tool's response: the same layout checks (box
// overlap, an edge cutting through an unrelated box, two edges crossing
// without jumpStyle=arc, a label landing on a box) that used to only happen
// when a human remembered to export a PNG and eyeball it. A critic run here
// is best-effort — never let a checker bug fail the mutation that already
// succeeded.
function withCriticReport(resultText: string, path: string, page: PageSelector | undefined): string {
  try {
    const issues = evaluateDiagram(path, page);
    const report = formatIssues(issues);
    return report ? `${resultText}\n\n${report}` : resultText;
  } catch (e) {
    return `${resultText}\n\n(layout check failed to run: ${(e as Error)?.message ?? e})`;
  }
}

const PORT = Number(process.env.DRAWIO_AGENTIC_PORT ?? 37651);

// The last file the forked draw.io app reported as open (POST /active-file).
// Lets every tool default to "the diagram you're looking at" instead of
// making every call repeat a path.
let activeFile: string | null = null;

function resolvePath(path: string | undefined): string {
  const resolved = path ?? activeFile;
  if (!resolved) {
    throw new Error(
      'No path given and no diagram is currently open. Open a .drawio file in draw.io first, or pass path explicitly.',
    );
  }
  return resolved;
}

// A fresh McpServer (and transport) per request, not one shared instance reused across
// the server's lifetime: McpServer refuses a second connect() while already connected to
// a transport ("Already connected to a transport... use a separate Protocol instance per
// connection" — the SDK's own error), so a shared instance breaks on the second request.
// Registration itself is cheap (just wiring closures), so this costs nothing real.
function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'drawio-agentic-mcp', version: '0.2.0' });

  server.tool(
    'create_diagram',
    'Create a new blank .drawio file. Refuses if the file already has content — call get_graph first and build on ' +
      'top of it with add_node/add_edge instead, or pass force:true to really replace an existing diagram.',
    {
      path: z.string().describe('Absolute path to the .drawio file to create'),
      pageWidth: z.number().optional(),
      pageHeight: z.number().optional(),
      force: z.boolean().optional().describe('Overwrite an existing non-empty diagram instead of refusing'),
    },
    async ({ path, ...opts }) => {
      createDiagram(path, opts);
      return { content: [{ type: 'text', text: `Created blank diagram at ${path}` }] };
    },
  );

  const pageSchema = z
    .union([z.number().int(), z.string()])
    .optional()
    .describe('Which page to use — a 0-based index or a page name (from list_pages). Defaults to the first page.');

  server.tool(
    'get_graph',
    "Read every cell (node or edge) in a .drawio file. Omit path to read whatever's currently open in draw.io.",
    {
      path: z.string().optional().describe('Absolute path; defaults to the file currently open in draw.io'),
      page: pageSchema,
    },
    async ({ path, page }) => {
      const cells = readGraph(resolvePath(path), page as PageSelector | undefined);
      return { content: [{ type: 'text', text: JSON.stringify(cells, null, 2) }] };
    },
  );

  server.tool(
    'list_pages',
    "List every page (tab) in a .drawio file, in order, with each page's name and index.",
    { path: z.string().optional().describe('Absolute path; defaults to the file currently open in draw.io') },
    async ({ path }) => {
      const pages = listPages(resolvePath(path));
      return { content: [{ type: 'text', text: JSON.stringify(pages, null, 2) }] };
    },
  );

  server.tool(
    'add_page',
    'Add a new blank page (tab) to a .drawio file — use for distinct layers/views of a diagram (e.g. a components ' +
      'view and a separate architecture view) rather than crowding one page.',
    {
      path: z.string().optional().describe('Absolute path; defaults to the file currently open in draw.io'),
      name: z.string().optional().describe('Page name shown on its tab; auto-generated if omitted'),
    },
    async ({ path, name }) => {
      const page = addPage(resolvePath(path), { name });
      return { content: [{ type: 'text', text: JSON.stringify(page) }] };
    },
  );

  server.tool(
    'add_node',
    'Add a rectangular node. Writes immediately to disk; an open draw.io window watching this file will reload. ' +
      "Omit path to target whatever's currently open in draw.io.",
    {
      path: z.string().optional().describe('Absolute path; defaults to the file currently open in draw.io'),
      id: z.string().optional().describe('Cell id; auto-generated if omitted'),
      label: z.string().optional().describe('Text shown on the node'),
      x: z.number().optional().describe('X position in diagram units'),
      y: z.number().optional().describe('Y position in diagram units'),
      width: z.number().optional(),
      height: z.number().optional(),
      style: z.string().optional().describe('mxGraph style string, e.g. rounded=1;fillColor=#dae8fc;'),
      parent: z.string().optional().describe('Parent cell id — use a container/group cell id to nest this node inside it; defaults to the root layer'),
      sketch: z.boolean().optional().describe('Render hand-drawn (native draw.io sketch style: jitter + hachure fill) instead of straight-edged; off by default'),
      page: pageSchema,
    },
    async ({ path, ...opts }) => {
      const resolved = resolvePath(path);
      const id = addNode(resolved, opts);
      return { content: [{ type: 'text', text: withCriticReport(id, resolved, opts.page as PageSelector | undefined) }] };
    },
  );

  server.tool(
    'add_edge',
    "Add an edge (arrow) between two existing cells. Omit path to target whatever's currently open in draw.io.",
    {
      path: z.string().optional(),
      source: z.string().describe('id of the source cell'),
      target: z.string().describe('id of the target cell'),
      id: z.string().optional(),
      label: z.string().optional(),
      style: z.string().optional(),
      parent: z.string().optional(),
      sketch: z.boolean().optional().describe('Render hand-drawn instead of straight; off by default'),
      page: pageSchema,
    },
    async ({ path, ...opts }) => {
      const resolved = resolvePath(path);
      const id = addEdge(resolved, opts);
      return { content: [{ type: 'text', text: withCriticReport(id, resolved, opts.page as PageSelector | undefined) }] };
    },
  );

  server.tool(
    'update_cell',
    'Update the label, style, or geometry of an existing cell. Call get_graph first if you don\'t already know its ' +
      'current id and values — this overwrites only the fields you pass, everything else on the cell is untouched.',
    {
      path: z.string().optional(),
      id: z.string(),
      label: z.string().optional(),
      style: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      page: pageSchema,
    },
    async ({ path, id, ...opts }) => {
      const resolved = resolvePath(path);
      updateCell(resolved, id, opts);
      return { content: [{ type: 'text', text: withCriticReport(`Updated ${id}`, resolved, opts.page as PageSelector | undefined) }] };
    },
  );

  server.tool(
    'delete_cell',
    'Delete a cell by id, along with any edges attached to it. Call get_graph first to confirm the id — this is ' +
      'the one irreversible per-cell operation.',
    { path: z.string().optional(), id: z.string(), page: pageSchema },
    async ({ path, id, page }) => {
      const resolved = resolvePath(path);
      const removed = deleteCell(resolved, id, page as PageSelector | undefined);
      return { content: [{ type: 'text', text: withCriticReport(`Removed ${removed} cell(s)`, resolved, page as PageSelector | undefined) }] };
    },
  );

  server.tool(
    'check_diagram',
    'Run the layout checks on demand (box overlap, an edge cutting through an unrelated box, two edges crossing ' +
      "without jumpStyle=arc, a label landing on a box) — every mutating tool already runs this automatically, " +
      'so this is for checking a diagram you did not just edit, or re-checking after several calls.',
    { path: z.string().optional(), page: pageSchema },
    async ({ path, page }) => {
      const issues = evaluateDiagram(resolvePath(path), page as PageSelector | undefined);
      return { content: [{ type: 'text', text: formatIssues(issues) || 'No layout issues found.' }] };
    },
  );

  server.tool(
    'run_layout',
    'Auto-arrange nodes that share a parent (the root layer, or a container/group cell id) using the ELK layered ' +
      'algorithm — the same open-source layout engine draw.io itself bundles. Repositions existing nodes in place; ' +
      'does not add or remove cells.',
    {
      path: z.string().optional(),
      parent: z.string().optional().describe("Cell id to lay out the children of; defaults to the root layer ('1')"),
      direction: z.enum(['RIGHT', 'DOWN', 'LEFT', 'UP']).optional().describe('Flow direction; defaults to RIGHT'),
      nodeSpacing: z.number().optional(),
      layerSpacing: z.number().optional(),
    },
    async ({ path, ...opts }) => {
      const count = await runLayout(resolvePath(path), opts);
      return { content: [{ type: 'text', text: `Laid out ${count} node(s)` }] };
    },
  );

  return server;
}

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function handleMcpRequest(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
): Promise<void> {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await createMcpServer().connect(transport);

  if (req.method !== 'POST') {
    await transport.handleRequest(req, res);
    return;
  }

  // Claude Code's client sends a 'server/discover' preflight before the real
  // 'initialize' — an undocumented extension our SDK version has no handler for.
  // Answer it ourselves with a benign empty result; everything else flows through
  // via the transport's pre-parsed-body path (we've already consumed the stream).
  const raw = await readBody(req);
  let parsed: { jsonrpc?: string; id?: unknown; method?: string } | undefined;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = undefined;
  }

  if (parsed?.method === 'server/discover') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: {} }));
    return;
  }

  await transport.handleRequest(req, res, parsed ?? raw);
}

export interface StartOptions {
  port?: number;
}

// Starts the HTTP server and resolves once it is listening. Never calls
// process.exit: bphamio runs this inside its own Electron main process, so
// exiting would take the whole app down with it. A port conflict (another
// instance already serving) rejects instead, and the caller decides.
export function startMcpServer(opts: StartOptions = {}): Promise<Server> {
  const port = opts.port ?? PORT;

  const httpServer = createHttpServer(async (req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      return;
    }

    if (req.url === '/active-file' && req.method === 'POST') {
      try {
        const body = JSON.parse(await readBody(req)) as { path?: string };
        if (typeof body.path === 'string' && body.path.length > 0) {
          activeFile = body.path;
        }
        res.writeHead(204);
        res.end();
      } catch {
        res.writeHead(400);
        res.end('bad request');
      }
      return;
    }

    if (req.url === '/active-file' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ path: activeFile }));
      return;
    }

    if (req.url === '/mcp') {
      try {
        await handleMcpRequest(req, res);
      } catch (e) {
        console.error('MCP handleRequest error:', e);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end(String((e as Error)?.stack ?? e));
        }
      }
      return;
    }

    res.writeHead(404);
    res.end('not found');
  });

  return new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, '127.0.0.1', () => {
      httpServer.off('error', reject);
      resolve(httpServer);
    });
  });
}
