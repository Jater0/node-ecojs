import { ChildProcess, fork } from 'child_process';
import { EventEmitter } from 'events';
var path = require("path");
import { Observable, Subject } from 'rxjs';
import { Device } from "node-hid";

/**
 * @namespace UsbDeviceAsync
 * @author Jater.Zhu
 * @description rewrite `node-hid`'s methods
 */
export interface UsbDeviceAsync {
  dataObservable(): Observable<Buffer>;
  errorObservable(): Observable<any>;
  write(values: number[] | Buffer): Promise<number>;
  readSync(): Promise<number[]>;
  close(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  sendFeatureReport(data: number[] | Buffer): Promise<number>;
  getFeatureReport(id: number, length: number): Promise<Buffer>;
}

/**
 * @namespace UsbIoDeviceAsync
 * @author Jater.Zhu
 * @description rewrite `node-hid`'s methods
 */
class UsbIoDeviceAsync implements UsbDeviceAsync {
  private worker: ChildProcess;
  private dispatcher = new EventEmitter();
  private dataSubject = new Subject<Buffer>();
  private errorSubject = new Subject<any>();

  constructor() {
    process.on("exit", this.destroy);
    this.worker = fork(path.join(__dirname, "io-worker.js"));
    this.worker.on("message", this.onMessage);
  }

  openPath(path: string): Promise<void> {
    return this.sendCommand({cmd: "openPath", data: path});
  }

  openId(vid: number, pid: number): Promise<void> {
    return this.sendCommand({cmd: "openId", data: {vid: vid, pid: pid}});
  }

  dataObservable(): Observable<Buffer> {
    return this.dataSubject.asObservable();
  }

  errorObservable(): Observable<any> {
    return this.errorSubject.asObservable();
  }

  write(values: number[] | Buffer): Promise<number> {
    return this.sendCommand({cmd: "write", data: (values instanceof Buffer) ? new Array(values) : values});
  }

  readSync(): Promise<number[]> {
      return this.sendCommand({cmd: "readSync"});
  }

  close(): Promise<void> {
    return this.sendCommand({cmd: "close"})
      .then(() => this.destroy())
      .catch((err) => {
        this.destroy();
        throw err;
      });
  }

  pause(): Promise<void> {
    return this.sendCommand({cmd: "pause"});
  }

  resume(): Promise<void> {
    return this.sendCommand({cmd: "resume"});
  }

  sendFeatureReport(data: number[] | Buffer): Promise<number> {
    return this.sendCommand({cmd: "sendFeatureReport", data: (data instanceof Buffer) ? new Array(data) : data});
  }

  getFeatureReport(id: number, length: number): Promise<Buffer> {
    return this.sendCommand({cmd: "getFeatureReport", data: {id: id, length: length}})
      .then(data => Buffer.from(data));
  }

  destroy = () => {
    if (this.worker) {
      this.worker.removeAllListeners();
      this.worker.kill();
    }
    this.dispatcher.removeAllListeners();
    this.dataSubject.complete();
    this.errorSubject.complete();
    process.removeListener("exit", this.destroy);
  }

  private sendCommand(msg: {cmd: string, data?: any}): Promise<any> {
    return new Promise((resolve, reject) => {
      const handler = (arg: {type: "done" | "error", data: any}) => {
        if (arg.type === "done") {
          resolve(arg.data);
        } else {
          reject(arg.data);
        }
      }
      this.dispatcher.once(msg.cmd, handler);
      this.worker.send(msg, (error: Error) => {
        if (error) {
          reject(error);
          this.dispatcher.removeListener(msg.cmd, handler);
        }
      });
    })
  }

  private onMessage = (message: any) => {
    if (message.type === "eventData") {
      this.dataSubject.next(Buffer.from(message.data));
    } else if (message.type === "eventError") {
      this.errorSubject.next(message.data);
    } else {
      this.dispatcher.emit(message.cmd, {
        type: message.type,
        data: message.data
      });
    }
  }
}

/**
 * @namespace UsbServiceAsync
 * @author Jater.Zhu
 * @description Async USBService
 */
export class UsbServiceAsync {
  private devicesWorker: ChildProcess;
  private ioDevices = new Set<UsbIoDeviceAsync>();

  constructor() {
    this.devicesWorker = fork(path.join(__dirname, "devices-worker.js"));
    process.on("exit", this.doDestroy);
  }

  devices(): Promise<Device[]> {
    return new Promise((resolve, reject) => {
      this.devicesWorker.once("message", 
        (message: {cmd: "devices", result?: Device[], error?: any}) => {
          if (message.cmd === "devices") {
            if (message.error) {
              reject(message.error);
            } else {
              resolve(message.result);
            }
          }
      });
      this.devicesWorker.send({cmd: "devices"}, (err: Error) => {
        if (err) {
          reject(err);
        }
      });
    });
  }

  open(path: string): Promise<UsbDeviceAsync>;
  open(vid: number, pid: number): Promise<UsbDeviceAsync>;
  open(first: string | number, pid?: number): Promise<UsbDeviceAsync> {
    let device: UsbIoDeviceAsync;
    try {
      device = new UsbIoDeviceAsync();
    } catch (error) {
      return Promise.reject(error);
    }
    const openPromise = (typeof first === "number") ? 
                          device.openId(first, pid) : device.openPath(first);
    return openPromise
            .then(() => {
              this.ioDevices.add(device);
              device.errorObservable()
                    .toPromise()
                    .then(() => this.ioDevices.delete(device));
              return device;
            }).catch(error => {
              device.destroy();
              throw error;
            });
  }

  destroy() {
    this.doDestroy();
  }

  private doDestroy = () => {
    if (this.devicesWorker) {
      this.devicesWorker.removeAllListeners();
      this.devicesWorker.kill();
    }
    this.ioDevices.forEach(device =>  device.destroy());
    process.removeListener("exit", this.doDestroy);
  }
}