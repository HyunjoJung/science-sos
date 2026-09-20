import { createPublicMcpHandler } from '@/lib/mcp/public-server.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=15;
const handler=createPublicMcpHandler({enabled:process.env.LEARNING_PUBLIC_MCP_ENABLED==='true',origin:process.env.APP_ORIGIN});
export {handler as GET,handler as POST,handler as DELETE,handler as OPTIONS};
