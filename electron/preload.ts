import { contextBridge, ipcRenderer } from "electron";
import type { Request } from "../shared/types";
ipcRenderer.on("meeting:capture-stop", () =>
  window.dispatchEvent(new Event("meeting-stop-request")),
);
contextBridge.exposeInMainWorld("meeting", {
  invoke: async (request: Request) => {
    const result = await ipcRenderer.invoke("meeting:request", request);
    if (!result.ok)
      throw Object.assign(new Error(result.error), {
        messageDescriptor: result.errorMessage,
      });
    return result.value;
  },
});
