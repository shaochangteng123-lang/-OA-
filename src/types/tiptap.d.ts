import '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    highlight: {
      /**
       * Toggle a highlight mark
       */
      toggleHighlight: (attributes?: { color?: string }) => ReturnType
    }
    color: {
      /**
       * Set the text color
       */
      setColor: (color: string) => ReturnType
      /**
       * Unset the text color
       */
      unsetColor: () => ReturnType
    }
    worklogParagraph: {
      /**
       * Insert a project paragraph
       */
      insertProjectParagraph: (project: {
        id: string
        name: string
        currentTask?: string
      }) => ReturnType
    }
  }
}
