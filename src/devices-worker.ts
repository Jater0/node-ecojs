import { devices } from "node-hid";

// create process to listen for messages to be published
process.on("message", (message: {cmd: string}) => {
  if (message.cmd === "devices") {
    try {
      const devs = devices();
      process.send({
        cmd: "devices",
        result: devs
      });
    } catch (error) {
      process.send({
        cmd: "devices", 
        error: typeof error?.toString === "function" ? error.toString() : error
      });
    }
  }
});