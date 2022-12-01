import { HID } from "node-hid";

let device: HID;

function hookEvents() {
  device.on("data", values => {
    process.send({
      type: "eventData",
      data: Array.from(values)
    });
  });
  device.on("error", error => {
    process.send({
      type: "eventError",
      data: typeof error?.toString === "function" ? error.toString() : error
    });
  })
}

enum HandlerErrorMessage {
  opened = "A device is already open",
  not_open = "Device is not open"
}

const handlers = {
  openPath: (path: string) => {
    if (device) {
      throw new Error(HandlerErrorMessage.opened);
    }
    device = new HID(path);
    hookEvents();
  },
  openId: (id: {vid: number, pid: number}) => {
    if (device) {
      throw new Error(HandlerErrorMessage.opened);
    }
    device = new HID(id.vid, id.pid);
    hookEvents();
  },
  write: (values: number[]) => {
    if (!device) {
      throw new Error(HandlerErrorMessage.not_open);
    }
    return device.write(values); 
  },
  readSync: () => {
    if (!device) {
      throw new Error(HandlerErrorMessage.not_open);
    }
    return device.readSync();
  },
  close: () => {
    if (!device) {
      throw new Error(HandlerErrorMessage.not_open);
    }
    return device.close();
  },
  pause: () => {
    if (!device) {
      throw new Error(HandlerErrorMessage.not_open);
    }
    return device.pause();
  },
  resume: () => {
    if (!device) {
      throw new Error(HandlerErrorMessage.not_open);
    }
    return device.resume();
  },
  sendFeatureReport: (data: number[]) => {
    if (!device) {
      throw new Error(HandlerErrorMessage.not_open);
    }
    return device.sendFeatureReport(data);
  },
  getFeatureReport: (data: {id: number, length: number}) => {
    if (!device) {
      throw new Error(HandlerErrorMessage.not_open);
    }
    return device.getFeatureReport(data.id, data.length);
  }
}

process.on("message", (message: {cmd: string, data?: any}) => {
  const handler = handlers[message.cmd];
  if (handler) {
    let result: any;
    try {
      result = handler(message.data);
    } catch (error) {
      process.send({
        cmd: message.cmd,
        type: "error",
        data: error
      });
      return;
    }
    process.send({
      cmd: message.cmd,
      type: "done",
      data: result
    });
  }
});

process.on("disconnect", () => {
  device?.close();
})