/**
 * Process escape sequences in text: \n, \t, \r, \_ (space), \\ (literal backslash)
 */
export function processEscapes(text: string): string {
  return text.replace(/\\(n|t|r|_|\\)/g, (_, c) =>
    ({ n: '\n', t: '\t', r: '\r', _: ' ', '\\': '\\' } as Record<string, string>)[c] ?? ('\\' + c)
  );
}
