/** RFC 5545: each physical line has at most 75 UTF-8 octets, continuation space included. */
export function foldCalendarLine(value: string): string {
  const lines: string[] = [];
  let line = "";
  let bytes = 0;
  for (const character of value) {
    const width = Buffer.byteLength(character, "utf8");
    if (bytes + width > 75) {
      lines.push(line);
      line = " ";
      bytes = 1;
    }
    line += character;
    bytes += width;
  }
  lines.push(line);
  return lines.join("\r\n");
}
