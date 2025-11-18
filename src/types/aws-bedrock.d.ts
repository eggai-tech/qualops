declare module '@aws-sdk/client-bedrock-runtime' {
  export class BedrockRuntimeClient {
    constructor(config: Record<string, unknown>);
    send<T>(command: T): Promise<unknown>;
  }

  export class InvokeModelCommand {
    constructor(input: Record<string, unknown>);
  }
}
