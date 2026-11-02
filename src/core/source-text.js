// Display legacy XML/HTML character references as text, never as executable HTML.
export function readableSource(text) {
  return String(text ?? '').replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_, name) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[name.toLowerCase()]))
    .replace(/&#(x[\da-f]+|\d+);/gi, (match, value) => {
      const code = value[0].toLowerCase() === 'x' ? parseInt(value.slice(1), 16) : Number(value);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : match;
    }).replace(/\r\n?/g, '\n').replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n');
}
