/**
 * Requires @copilotkit/runtime > 1.51.3
 * HistoryHydratingAgentRunner for Google ADK
 *
 * A custom AgentRunner that extends CopilotKit's base runner to add
 * message history hydration support for Google ADK agents via HttpAgent.
 *
 * Fixes the issue where page refreshes don't load historical messages
 * by fetching thread state from your backend and emitting MESSAGES_SNAPSHOT events.
 *
 * @example
 * ```typescript
 * import { HistoryHydratingAgentRunner } from './history-hydrating-runner';
 * import { HttpAgent } from '@ag-ui/client';
 *
 * const agent = new HttpAgent({
 *  url: 'http://localhost:8080/api/v1/ag-ui-adk',
 *  headers: { user: 'test_user' },
 *  debug: true,
 * });
 *
 * const runner = new HistoryHydratingAgentRunner({
 *  agent,
 *  backendUrl: 'http://localhost:8080',
 *  historyEndpoint: `${agent.url + '/agents/state'}`, // /agents/state is provided by adk middleware for fetching thread history
 *  historyLimit: 100,
 *  debug: true,
 *  headers: agentHeaders, // Optional additional headers for history requests
 *  timeoutMs: 30000, // Optional timeout for history requests
 *  userId: 'test_user', // Optional user ID for personalized history fetching
 * });
 *
 * const runtime = new CopilotRuntime({
 *  agents: { my_agent: agent },
 *  runner,
 * });
 * 
 * const route = createCopilotEndpointSingleRoute({
 *  runtime,
 *  basepath: '/api/copilot',
 * })
 * ```
 */

import { type BaseEvent, EventType } from "@ag-ui/core";
import { HttpAgent } from '@ag-ui/client';
import {
  AgentRunner,
  type AgentRunnerConnectRequest,
  type AgentRunnerRunRequest,
  type AgentRunnerStopRequest,
} from "@copilotkitnext/runtime";
import { Observable } from "rxjs";

import { HistoryHydratingRunnerConfig, ThreadHistoryResponse, Message } from "./types";

const DEFAULT_HISTORY_LIMIT = 100;
const DEFAULT_TIMEOUT = 30000;

export class HistoryHydratingAgentRunner extends AgentRunner {

  private agent: HttpAgent;
  private historyEndpoint: string;
  private historyLimit: number;
  private debug: boolean;
  private headers: Record<string, string>;
  private timeoutMs: number;
  private userId?: string;

  constructor(config: HistoryHydratingRunnerConfig) {
    super();
    this.agent = config.agent;
    this.historyEndpoint = config.historyEndpoint;
    this.historyLimit = config.historyLimit ?? DEFAULT_HISTORY_LIMIT;
    this.debug = config.debug ?? false;
    this.headers = config.headers ?? {};
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT;
    this.userId = config.userId;
  }

  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log('[HistoryHydratingRunner]', ...args);
    }
  }

  private warn(...args: unknown[]): void {
    console.warn('[HistoryHydratingRunner]', ...args);
  }

  private error(...args: unknown[]): void {
    console.error('[HistoryHydratingRunner]', ...args);
  }

  /**
   * Fetch thread history from your backend
   */
  private async fetchThreadHistory(threadId: string): Promise<ThreadHistoryResponse | null> {
    try {
      this.log(`Fetching history from: ${this.historyEndpoint}`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(this.historyEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
        },
        body: JSON.stringify({
          threadId,
          userId: this.userId, // Pass userId for personalized history fetching
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        this.warn(`History fetch failed: ${response.status} ${response.statusText}`);
        return null;
      }

      const data: ThreadHistoryResponse = await response.json();

      const rawMessages = data.messages;

      let parsedMessages: Message[] = [];
      try {
        parsedMessages = Array.isArray(rawMessages)
          ? rawMessages
          : typeof rawMessages === "string"
            ? JSON.parse(rawMessages || "[]")
            : [];
      } catch (error) {
        this.error("Failed to parse history messages:", error, rawMessages);
        parsedMessages = [];
      }

      this.log(`Loaded ${parsedMessages.length} messages from history`);

      return { ...data, messages: parsedMessages };
    } catch (error) {
      this.error('Error fetching thread history:', error);
      return null;
    }
  }

  /**
   * Connect to a thread and hydrate its history
   */
  override connect(request: AgentRunnerConnectRequest): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      const hydrate = async () => {
        const { threadId } = request;
        this.log(`Connecting to thread: ${threadId}`);

        try {
          // Fetch thread history from backend
          const historyData = await this.fetchThreadHistory(threadId);

          if (!historyData || !historyData.messages || historyData.messages.length === 0) {
            this.warn(`No history found for thread ${threadId}`);

            // Emit required events so frontend doesn't get empty response
            const fallbackRunId = "hydration_" + Math.random().toString(36).slice(2);

            subscriber.next({
              type: EventType.RUN_STARTED,
              timestamp: Date.now(),
              threadId,
              runId: fallbackRunId,
            } as BaseEvent);

            subscriber.next({
              type: EventType.MESSAGES_SNAPSHOT,
              messages: [],
              timestamp: Date.now(),
              threadId,
              runId: fallbackRunId,
            } as BaseEvent);

            subscriber.next({
              type: EventType.RUN_FINISHED,
              timestamp: Date.now(),
              threadId,
              runId: fallbackRunId,
            } as BaseEvent);

            subscriber.complete();
            return;
          }

          // Apply history limit
          const limitedMessages = this.historyLimit > 0
            ? historyData.messages.slice(-this.historyLimit)
            : historyData.messages;

          const transformedMessages = limitedMessages
            .filter((msg) => msg && typeof msg.id === "string" && typeof msg.role === "string")
            .map((msg) => {
              const role = msg.role as "user" | "assistant" | "system" | "tool";
              const normalizedContent =
                msg.content == null ? "" : typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);

              const base = {
                id: msg.id,
                role,
                content: normalizedContent,
                createdAt: msg.createdAt || Date.now(),
                ...(Object.hasOwn(msg, "toolCalls") && msg.toolCalls ? { toolCalls: msg.toolCalls } : {}),
              };

              if (role === "tool") {
                return {
                  ...base,
                  toolCallId:
                    typeof msg.toolCallId === "string" && msg.toolCallId.length > 0
                      ? msg.toolCallId
                      : msg.id,
                };
              }

              return base;
            });

          const runId = historyData.runId || "hydration_" + Math.random().toString(36).slice(2);

          // Emit RUN_STARTED event
          subscriber.next({
            type: EventType.RUN_STARTED,
            timestamp: Date.now(),
            threadId,
            runId,
          } as BaseEvent);

          // Emit MESSAGES_SNAPSHOT - this is what the frontend needs for hydration
          subscriber.next({
            type: EventType.MESSAGES_SNAPSHOT,
            messages: transformedMessages,
            timestamp: Date.now(),
            threadId,
            runId,
          } as BaseEvent);

          // Emit STATE_SNAPSHOT if backend provided state
          if (historyData.state) {
            subscriber.next({
              type: "STATE_SNAPSHOT" as unknown as typeof EventType.CUSTOM,
              snapshot: historyData.state,
              timestamp: Date.now(),
              threadId,
              runId,
            } as unknown as BaseEvent);
          }

          // Emit RUN_FINISHED
          subscriber.next({
            type: EventType.RUN_FINISHED,
            timestamp: Date.now(),
            threadId,
            runId,
          } as BaseEvent);

          subscriber.complete();
        } catch (error) {
          this.error('Error during history hydration:', error);

          // Emit error events
          const fallbackRunId = "hydration_error_" + Math.random().toString(36).slice(2);

          subscriber.next({
            type: EventType.RUN_STARTED,
            timestamp: Date.now(),
            threadId,
            runId: fallbackRunId,
          } as BaseEvent);

          subscriber.next({
            type: EventType.MESSAGES_SNAPSHOT,
            messages: [],
            timestamp: Date.now(),
            threadId,
            runId: fallbackRunId,
          } as BaseEvent);

          subscriber.next({
            type: EventType.RUN_FINISHED,
            timestamp: Date.now(),
            threadId,
            runId: fallbackRunId,
          } as BaseEvent);

          subscriber.complete();
        }
      };

      hydrate();
    });
  }

  /**
   * Run the agent - delegate to the HttpAgent's run method
   */
  override run(request: AgentRunnerRunRequest): Observable<BaseEvent> {
    this.log('Running agent for thread:', request.input.threadId);

    // Delegate to the HttpAgent
    return this.agent.run(request.input);
  }

  /**
   * Stop a running agent
   */
  async stop(_request: AgentRunnerStopRequest): Promise<boolean | undefined> {
    const result = this.agent.abortRun();
    return result !== undefined ? result : true;
  }

  /**
   * Delegate isRunning to the agent.
   */
  async isRunning(): Promise<boolean> {
    return this.agent.isRunning;
  }
}