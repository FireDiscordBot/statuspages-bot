import { Message as DJSMessage, Structures, Client } from "discord.js";
import { RawMessageData } from "discord.js/typings/rawDataTypes";
import { PaginatorInterface } from "./paginators";

export class Message extends DJSMessage {
  paginator: PaginatorInterface;

  constructor(client: Client, data: RawMessageData) {
    super(client, data);
  }
}

Structures.extend("Message", () => Message);
