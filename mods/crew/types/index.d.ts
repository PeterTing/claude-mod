/** The pane's tabs. */
export type CrewTab = 'overview' | 'progress' | 'board' | 'threads' | 'memory' | 'tokens'

/** The sample situation the design preview shows. */
export type CrewScenario = 'normal' | 'empty' | 'attention'

declare module 'claude-code' {
  interface PluginState {
    crew: {
      /** `/crew demo` is showing the design preview. */
      isDemo: boolean
      /** The tab the pane shows. */
      tab: CrewTab
      /** The sample situation the preview shows. */
      scenario: CrewScenario
      /** The item whose thread the Threads tab has open, if any. */
      thread: string | null
      /** The gate whose detail the overview has open, if any. */
      gate: string | null
    }
  }
}
