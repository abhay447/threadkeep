import { ensureFrontend } from "./ensureFrontend.js";
import { startServer } from "./index.js";

await ensureFrontend();
await startServer();
