export function ignoreConsoleWarnings(warningsToIgnore: string[]) {
  const originalEmitWarning = process.emitWarning

  process.emitWarning = (warning, ...args) => {
    if (
      typeof warning === 'string' &&
      warningsToIgnore.some(ignoredWarning => warning.includes(ignoredWarning))
    ) {
      return
    }

    originalEmitWarning(warning, ...(args as string[]))
  }
}
