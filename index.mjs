import { serve } from "./src/plugin.mjs"

export const WorkBuddyTasksPlugin = (input) => serve("workbuddy", input)

export const WorkBuddyAITasksPlugin = (input) => serve("workbuddy-ai", input)
