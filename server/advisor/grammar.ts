// node-llama-cpp's schema helper makes every property mandatory and cannot
// represent array constants. Compile our small, owned JSON-schema subset to
// GBNF so optional patches and literal identifiers keep their original meaning.
export function jsonGrammar(schema: unknown): string {
  const rules = [String.raw`ws ::= [ \t\n\r]*`, String.raw`char ::= [^"\\\x00-\x1f] | "\\" (["\\/bfnrt] | "u" [0-9a-fA-F]{4})`];
  let count = 0;
  const add = (body: string) => { const name = `r${count++}`; rules.push(`${name} ::= ${body}`); return name; };
  const literal = (value: unknown) => JSON.stringify(JSON.stringify(value));
  const value = (input: unknown): string => {
    const entry = input as { const?: unknown; enum?: unknown[]; type?: string; properties?: Record<string, unknown>; required?: string[]; items?: unknown; minItems?: number; maxItems?: number; minLength?: number; maxLength?: number; minimum?: number; maximum?: number };
    if (Object.hasOwn(entry, 'const')) return add(`${literal(entry.const)} ws`);
    if (entry.enum) return add(`(${entry.enum.map(literal).join(' | ')}) ws`);
    if (entry.type === 'string') return add(String.raw`"\"" char{${entry.minLength || 0},${entry.maxLength || 300}} "\"" ws`);
    if (entry.type === 'integer') {
      if (entry.minimum !== undefined && entry.maximum !== undefined && entry.maximum - entry.minimum <= 100) return add(`(${Array.from({ length: entry.maximum - entry.minimum + 1 }, (_, index) => literal(entry.minimum! + index)).join(' | ')}) ws`);
      return add('"-"? ("0" | [1-9] [0-9]*) ws');
    }
    if (entry.type === 'array') {
      const item = value(entry.items);
      const min = entry.minItems || 0;
      const max = entry.maxItems || 8;
      const sequence = `${item} ("," ws ${item}){${Math.max(0, min - 1)},${max - 1}}`;
      return add(`"[" ws ${min ? sequence : `(${sequence})?`} "]" ws`);
    }
    if (entry.type === 'object') {
      const properties = Object.entries(entry.properties || {}).map(([key, item]) => ({ key, rule: value(item) }));
      let first = add('""');
      let more = first;
      for (const property of properties.reverse()) {
        const field = `${JSON.stringify(JSON.stringify(property.key))} ws ":" ws ${property.rule}`;
        const required = entry.required?.includes(property.key);
        const nextFirst = add(`${field} ${more}${required ? '' : ` | ${first}`}`);
        more = add(`"," ws ${field} ${more}${required ? '' : ` | ${more}`}`);
        first = nextFirst;
      }
      return add(`"{" ws ${first} "}" ws`);
    }
    throw new Error('Unsupported advisor schema.');
  };
  const root = value(schema);
  return `${rules.join('\n')}\nroot ::= ${root}`;
}
