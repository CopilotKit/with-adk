import { HttpAgent } from '@ag-ui/client';

export interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    createdAt?: number;
    toolCallId?: string;
    toolName?: string;
    [key: string]: unknown;
}

export interface ThreadHistoryResponse {
    messages: Message[];
    state?: Record<string, unknown>;
    threadId: string;
    runId?: string;
}

export interface HistoryHydratingRunnerConfig {
    /** The HttpAgent instance pointing to your Google ADK backend */
    agent: HttpAgent;

    /** Base URL of your backend (e.g., 'http://localhost:8080') */
    backendUrl: string;

    /**
     * Endpoint pattern for fetching thread history.
     * Use {threadId} placeholder (e.g., '/api/v1/threads/{threadId}/history')
     */
    historyEndpoint: string;

    /** Maximum number of messages to load from history (default: 100) */
    historyLimit?: number;

    /** Enable debug logging */
    debug?: boolean;

    /** Custom headers to send with history requests */
    headers?: Record<string, string>;

    /** Timeout for history fetch requests in ms (default: 30000) */
    timeoutMs?: number;

    userId?: string; // Optional user ID for personalized history fetching
}