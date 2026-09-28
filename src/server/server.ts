import express from "express";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import { v4 as uuidv4 } from "uuid";

interface CanvasElement {
  id: string;
  type: string;
  [key: string]: unknown;
}

interface DrawMessage {
  action: "draw";
  element: CanvasElement;
}

interface MoveMessage {
  action: "move";
  id: string;
  x: number;
  y: number;
}

interface DeleteMessage {
  action: "delete";
  id: string;
}

interface ClearMessage {
  action: "clear";
}

type ClientMessage = DrawMessage | MoveMessage | DeleteMessage | ClearMessage;

const app = express();
app.use(cors());

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const canvasElements: CanvasElement[] = [];

wss.on("connection", (ws: WebSocket) => {
  ws.send(JSON.stringify({ action: "snapshot", elements: canvasElements }));

  ws.on("message", (raw: Buffer) => {
    let message: ClientMessage;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (message.action) {
      case "draw": {
        const element = message.element;
        if (!element.id) {
          element.id = uuidv4();
        }
        canvasElements.push(element);
        wss.clients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ action: "draw", element }));
          }
        });
        break;
      }
      case "move": {
        const idx = canvasElements.findIndex((el) => el.id === message.id);
        if (idx !== -1) {
          canvasElements[idx].x = message.x;
          canvasElements[idx].y = message.y;
        }
        wss.clients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(
              JSON.stringify({
                action: "move",
                id: message.id,
                x: message.x,
                y: message.y,
              })
            );
          }
        });
        break;
      }
      case "delete": {
        const delIdx = canvasElements.findIndex((el) => el.id === message.id);
        if (delIdx !== -1) {
          canvasElements.splice(delIdx, 1);
        }
        wss.clients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ action: "delete", id: message.id }));
          }
        });
        break;
      }
      case "clear": {
        canvasElements.length = 0;
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ action: "clear" }));
          }
        });
        break;
      }
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
  });
});

server.listen(3001, () => {
  console.log("Server running on port 3001");
});
