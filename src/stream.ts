import { TavilySearchResults } from "@langchain/community/tools/tavily_search";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { StateGraph, MessagesAnnotation } from "@langchain/langgraph";
import dotenv from "dotenv";
import { isAIMessageChunk } from "@langchain/core/messages";
dotenv.config();

// Define the tools for the agent to use
const tools = [new TavilySearchResults({
  apiKey: process.env.TAVILY_API_KEY,
  maxResults: 3
})];
const toolNode = new ToolNode(tools);

// Create a model and give it access to the tools
const model = new ChatOpenAI({
  model: "gpt-4o-mini",
  apiKey: process.env.OPENAI_API_KEY,
  temperature: 0,
  streaming: true,
}).bindTools(tools);

// Define the function that determines whether to continue or not
function shouldContinue({ messages }: typeof MessagesAnnotation.State) {
  const lastMessage = messages[messages.length - 1];

  // If the LLM makes a tool call, then we route to the "tools" node
  if (lastMessage.additional_kwargs.tool_calls) {
    return "tools";
  }
  // Otherwise, we stop (reply to the user) using the special "__end__" node
  return "__end__";
}

// Define the function that calls the model
async function callModel(state: typeof MessagesAnnotation.State) {
  const response = await model.invoke(state.messages);

  // We return a list, because this will get added to the existing list
  return { messages: [response] };
}

// Define a new graph
const workflow = new StateGraph(MessagesAnnotation)
  .addNode("agent", callModel)
  .addEdge("__start__", "agent") // __start__ is a special name for the entrypoint
  .addNode("tools", toolNode)
  .addEdge("tools", "agent")
  .addConditionalEdges("agent", shouldContinue);

// Finally, we compile it into a LangChain Runnable.
const app = workflow.compile();

// Use the agent
const runAgent = async () => {
  // for await (
  //   const chunk of await app.stream({
  //     messages: [new HumanMessage("what is the weather in sf")],
  //   }, {
  //     streamMode: "values",
  //   })
  // ) {
  //   console.log(chunk["messages"]);
  //   console.log("\n====\n");
  // }

  // for await (
  //   const chunk of await app.stream({
  //     messages: [new HumanMessage("what is the weather in sf")],
  //   }, {
  //     streamMode: "updates",
  //   })
  // ) {
  //   for (const [node, values] of Object.entries(chunk)) {
  //     console.log(`Receiving update from node: ${node}`);
  //     console.log(values);
  //     console.log("\n====\n");
  //   }
  // }



  const stream = await app.stream(
    { messages: [new HumanMessage("what is the weather in sf")] },
    { streamMode: "messages" },
  );

  for await (const [message, _metadata] of stream) {
    if (isAIMessageChunk(message) && message.tool_call_chunks?.length) {
      console.log(`${message.getType()} MESSAGE TOOL CALL CHUNK: ${message.tool_call_chunks[0].args}`);
    } else {
      console.log(`${message.getType()} MESSAGE CONTENT: ${message.content}`);
    }
  }
};

runAgent().catch(console.error);
