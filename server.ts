import { createSyncServer } from './src/sync/server-core';

const PORT = Number(process.env.PORT ?? 3001);

const syncServer = createSyncServer();

syncServer.server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`WebSocket server running on ws://localhost:${PORT}/ws`);
});
