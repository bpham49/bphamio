#!/usr/bin/env node
// Standalone entry: runs the MCP server outside bphamio (e.g. against stock
// draw.io). Inside bphamio the app starts the same server in-process.
import { startMcpServer } from './server.ts';

const port = Number(process.env.DRAWIO_AGENTIC_PORT ?? 37651);

try {
  await startMcpServer({ port });
  console.error(`drawio-agentic-mcp listening on http://127.0.0.1:${port}/mcp`);
} catch (e) {
  if ((e as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use — another instance (or bphamio itself) is probably serving.`);
    process.exit(1);
  }
  throw e;
}
