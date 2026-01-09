"use client";

import { ProverbsCard } from "@/components/proverbs";
import { WeatherCard } from "@/components/weather";
import { AgentState } from "@/lib/types";
import {
  CopilotKit,
  useCoAgent,
  useRenderToolCall,
} from "@copilotkit/react-core";
import { CopilotSidebar } from "@copilotkit/react-core/v2";
import { useState } from "react";


export default function CopilotKitPage() {
  // 1. Define threads
  const threads = [
    "123",
    "456",
    "789",
  ];

  // 2. Set thread state
  const [thread, setThread] = useState(threads[0]);
  
  return (
    <main>
      
      <CopilotKit runtimeUrl="/api/copilotkit" agent="my_agent" >
        <CopilotSidebar
          // 3. Set threadId
          threadId={thread}
          defaultOpen={true}

          // Custom Header w/ threads
          // @ts-ignore
          header={() => <div className="py-4 px-10 flex justify-between border-b items-center">
            <h1 className="text-lg font-thin">AI Chat</h1>
            <div className="flex gap-2">
              <button className="bg-zinc-900 text-white px-4 py-2 rounded-full text-sm cursor-pointer hover:bg-zinc-800" onClick={() => setThread(threads[0])}>Thread 1</button>
              <button className="bg-zinc-900 text-white px-4 py-2 rounded-full text-sm cursor-pointer hover:bg-zinc-800" onClick={() => setThread(threads[1])}>Thread 2</button>
            </div>
          </div>}
        />
        <YourMainContent />
      </CopilotKit>
    </main>
  );
}

function YourMainContent() {
  // 🪁 Shared State: https://docs.copilotkit.ai/adk/shared-state
  const { state, setState } = useCoAgent<AgentState>({
    name: "my_agent",
    initialState: {
      proverbs: [
        "CopilotKit may be new, but its the best thing since sliced bread.",
      ],
    },
  });

  //🪁 Generative UI: https://docs.copilotkit.ai/adk/generative-ui
  useRenderToolCall(
    {
      name: "get_weather",
      description: "Get the weather for a given location.",
      parameters: [{ name: "location", type: "string", required: true }],
      render: ({ args }) => {
        return <WeatherCard location={args.location} />;
      },
    },
  );

  return (
    <div
      style={{ backgroundColor: "maroon" }}
      className="h-screen flex justify-center items-center flex-col transition-colors duration-300"
    >
      <ProverbsCard state={state} setState={setState} />
    </div>
  );
}
