interface WorkerSpec {
  id: string;
  issueNumber: number;
  repo: string;
  branch: string;
  title: string;
  [key: string]: unknown;
}

interface IncomingMessage {
  type: "spec";
  payload: WorkerSpec;
}

interface OutgoingMessage {
  type: "result";
  success: boolean;
  error?: string;
}

function sendResult(success: boolean, error?: string): void {
  const msg: OutgoingMessage = { type: "result", success, error };
  if (process.send) {
    process.send(msg);
  }
}

async function executeFixWorkflow(spec: WorkerSpec): Promise<void> {
  console.log(`[Worker ${spec.id}] Starting fix workflow for issue #${spec.issueNumber}`);
  console.log(`[Worker ${spec.id}] Repository: ${spec.repo}`);
  console.log(`[Worker ${spec.id}] Branch: ${spec.branch}`);
  console.log(`[Worker ${spec.id}] Title: ${spec.title}`);

  await new Promise((resolve) => setTimeout(resolve, 100));

  console.log(`[Worker ${spec.id}] Fix workflow completed for issue #${spec.issueNumber}`);
}

process.on("message", async (msg: IncomingMessage) => {
  if (msg.type !== "spec") {
    return;
  }

  const spec = msg.payload;

  try {
    await executeFixWorkflow(spec);
    sendResult(true);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Worker ${spec.id}] Error: ${errorMsg}`);
    sendResult(false, errorMsg);
  }

  process.exit(0);
});

process.on("disconnect", () => {
  process.exit(0);
});
