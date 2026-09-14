import { startServer } from "./api/server.js";
import { startWorker } from "./worker/worker.js";

async function main() {
  console.log("=================================================");
  console.log(" Backend Monitoring Tanki RSA UGM ");
  console.log("=================================================");

  // REST API dan Websocket
  await startServer();

  // MQTT Worker
  await startWorker();
}

main().catch((err) => {
  console.error("Fatal error starting application:", err);
  process.exit(1);
});

